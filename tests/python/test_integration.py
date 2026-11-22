"""Real HTTP → Node API → PostgreSQL / MinIO integration tests, without mocks."""
import copy
import unittest
import uuid

from support import Client, PNG, current_state, database_connection


class CatalogueIntegration(unittest.TestCase):
    def setUp(self):
        self.db = database_connection()
        self.addCleanup(self.db.close)
        # A rate-limit test must not lock out a later independent test case.
        self.db.execute("DELETE FROM login_attempts")
        self.client = Client()
        self.client.login()

    def test_public_site_api_and_database_agree(self):
        code, _, body = self.client.request("/")
        self.assertEqual(code, 200)
        self.assertIn(b"cloud-store.js", body)
        for path in ("/admin.html", "/app.js", "/cloud-store.js"):
            self.assertEqual(self.client.request(path)[0], 200, path)
        self.assertEqual(self.client.json("/api/health")[2], {"ok": True})
        state = current_state(self.client)
        row = self.db.execute("SELECT payload, revision FROM catalog_state WHERE id=1").fetchone()
        self.assertEqual(state["revision"], row[1])
        self.assertEqual(state["products"], row[0]["products"])
        self.assertGreater(len(state["products"]), 0)
        self.assertEqual(self.client.json("/api/catalogue")[1]["Cache-Control"], "no-store")

    def test_seeded_images_are_in_s3_with_database_metadata(self):
        state = current_state(self.client)
        sources = {p["photo"] for p in state["products"] if p.get("photo")}
        for product in state["products"]:
            sources.update(product.get("photos", []))
        sources.update(v for v in state["site"].values() if isinstance(v, str) and v.startswith("http://minio:9000/"))
        self.assertGreater(len(sources), 0)
        for url in sorted(sources):
            with self.subTest(image=url.rsplit("/", 1)[-1]):
                self.assertTrue(url.startswith("http://minio:9000/catalog-integration/"))
                meta = self.db.execute("SELECT content_type, size_bytes FROM media WHERE url=%s", (url,)).fetchone()
                self.assertIsNotNone(meta)
                code, headers, _ = self.client.request(url, "HEAD")
                self.assertEqual(code, 200)
                self.assertEqual(int(headers["Content-Length"]), meta[1])
                self.assertEqual(headers["Content-Type"], meta[0])

    def test_add_edit_delete_object_category_and_site_text(self):
        original = current_state(self.client)
        self.addCleanup(self.restore_catalogue, original)
        next_state = copy.deepcopy(original)
        category = "Тестовая категория " + uuid.uuid4().hex[:8]
        next_state["categories"].append(category)
        product = {"name": "Интеграционный объект", "resident": "Тест", "type": category,
                   "price": "150 000 ₽", "specs": "400 × 400 × 580 мм", "description": "Проверка сохранения",
                   "photo": "", "photos": [], "variants": [{"size": "400 × 400 мм", "price": "88 000 ₽"}]}
        next_state["products"].append(product)
        next_state["site"]["coverIntro"] = "Текст, опубликованный интеграционным тестом"
        code, _, saved = self.client.json("/api/catalogue", "PUT", next_state)
        self.assertEqual(code, 200)
        # New HTTP client, no shared session or browser-local state.
        published = current_state(Client())
        self.assertEqual(published["products"][-1], product)
        self.assertIn(category, published["categories"])
        self.assertEqual(published["site"]["coverIntro"], next_state["site"]["coverIntro"])
        row = self.db.execute("SELECT payload FROM catalog_state WHERE id=1").fetchone()[0]
        self.assertEqual(row["products"][-1], product)
        self.assertEqual(self.client.json("/api/catalogue", "PUT", next_state)[0], 409)
        published["products"][-1]["price"] = "160 000 ₽"
        self.assertEqual(self.client.json("/api/catalogue", "PUT", published)[0], 200)
        self.assertEqual(current_state(Client())["products"][-1]["price"], "160 000 ₽")
        deleted = current_state(self.client)
        deleted["products"].pop()
        deleted["categories"].remove(category)
        self.assertEqual(self.client.json("/api/catalogue", "PUT", deleted)[0], 200)
        self.assertNotIn(category, current_state(Client())["categories"])

    def restore_catalogue(self, snapshot):
        snapshot = copy.deepcopy(snapshot)
        snapshot["revision"] = current_state(self.client)["revision"]
        self.assertEqual(self.client.json("/api/catalogue", "PUT", snapshot)[0], 200)

    def test_direct_s3_upload_download_cors_and_metadata(self):
        code, _, ticket = self.client.json("/api/upload", "POST", {"type": "image/png", "size": len(PNG)})
        self.assertEqual(code, 200)
        code, cors, _ = self.client.request(ticket["uploadUrl"], "OPTIONS", headers={
            "Origin": self.client.base, "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type"})
        self.assertIn(code, (200, 204))
        self.assertEqual(cors["Access-Control-Allow-Origin"], self.client.base)
        code, _, _ = self.client.request(ticket["uploadUrl"], "PUT", raw=PNG, headers={"Content-Type": "image/png"})
        self.assertEqual(code, 200)
        code, _, finished = self.client.json("/api/upload", "POST", {"key": ticket["key"]})
        self.assertEqual(code, 200)
        self.assertEqual(Client().request(finished["url"])[2], PNG)
        row = self.db.execute("SELECT object_key, content_type, size_bytes FROM media WHERE url=%s", (finished["url"],)).fetchone()
        self.assertEqual(row, (ticket["key"], "image/png", len(PNG)))

    def test_authentication_csrf_logout_and_private_files(self):
        anonymous = Client()
        self.assertFalse(anonymous.json("/api/session")[2]["authenticated"])
        self.assertEqual(anonymous.json("/api/catalogue", "PUT", current_state(self.client))[0], 401)
        self.assertEqual(anonymous.json("/api/upload", "POST", {"type": "image/png", "size": len(PNG)})[0], 401)
        self.assertEqual(self.client.json("/api/catalogue", "PUT", current_state(self.client), origin="https://evil.example")[0], 403)
        self.assertEqual(anonymous.json("/api/session", "POST", {"password": "wrong"})[0], 401)
        forged = Client()
        self.assertFalse(forged.json("/api/session", headers={"Cookie": "catalog_session=9999999999.forged"})[2]["authenticated"])
        self.assertEqual(self.client.json("/api/session", "DELETE")[0], 200)
        self.assertFalse(self.client.json("/api/session")[2]["authenticated"])
        for path in ("/.env", "/server/auth.mjs", "/package.json", "/.git/config"):
            self.assertEqual(anonymous.request(path)[0], 404, path)

    def test_embedded_browser_without_origin_uses_same_origin_referer(self):
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        import json
        import os
        body = json.dumps({"password": os.environ["ADMIN_PASSWORD"]}).encode()
        for referrer, expected in ((self.client.base + "/admin.html", 200), ("https://evil.example/admin.html", 403), (None, 403)):
            headers = {"Content-Type": "application/json"}
            if referrer:
                headers["Referer"] = referrer
            request = Request(self.client.base + "/api/session", data=body, headers=headers, method="POST")
            try:
                response = urlopen(request, timeout=30)
            except HTTPError as error:
                response = error
            with response:
                self.assertEqual(response.code, expected)

    def test_invalid_input_does_not_change_published_data(self):
        original = current_state(self.client)
        invalid = copy.deepcopy(original)
        invalid["products"][0]["price"] = ""
        self.assertEqual(self.client.json("/api/catalogue", "PUT", invalid)[0], 400)
        invalid["products"][0]["price"] = "По запросу"
        invalid["products"][0]["photo"] = "javascript:alert(1)"
        self.assertEqual(self.client.json("/api/catalogue", "PUT", invalid)[0], 400)
        self.assertEqual(self.client.request("/api/catalogue", "PUT", raw=b"{bad-json", headers={"Content-Type": "application/json"})[0], 400)
        for mime, size in (("image/svg+xml", 100), ("image/png", 9 * 1024 * 1024), ("image/png", -1)):
            self.assertEqual(self.client.json("/api/upload", "POST", {"type": mime, "size": size})[0], 400)
        self.assertEqual(current_state(self.client), original)

    def test_login_attempt_limit_uses_postgres(self):
        anonymous = Client()
        for _ in range(10):
            self.assertEqual(anonymous.json("/api/session", "POST", {"password": "wrong"})[0], 401)
        self.assertEqual(anonymous.json("/api/session", "POST", {"password": "wrong"})[0], 429)
        self.assertEqual(self.db.execute("SELECT attempts FROM login_attempts").fetchone()[0], 11)


if __name__ == "__main__":
    unittest.main(verbosity=2)
