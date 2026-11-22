"""Verify persisted data after re-running seed and restarting the API container."""
import sys
from support import Client, current_state, database_connection

MARKER = "integration-test: persisted after seed and web restart"


def main():
    client = Client()
    client.login()
    if sys.argv[1:] == ["write"]:
        state = current_state(client)
        state["site"]["coverIntro"] = MARKER
        if client.json("/api/catalogue", "PUT", state)[0] != 200:
            raise AssertionError("Could not save persistence marker")
    elif sys.argv[1:] == ["verify"]:
        state = current_state(Client())
        if state["site"].get("coverIntro") != MARKER:
            raise AssertionError("Seed or restart lost the published change")
        with database_connection() as db:
            payload = db.execute("SELECT payload FROM catalog_state WHERE id=1").fetchone()[0]
            if payload["site"].get("coverIntro") != MARKER:
                raise AssertionError("Published change is missing from PostgreSQL")
        if Client().request(state["products"][0]["photo"])[0] != 200:
            raise AssertionError("Seeded S3 image is not accessible after restart")
        print("PASS: repeat seed and API restart preserve data and S3 images.")
    else:
        raise SystemExit("Usage: persistence_probe.py write|verify")


if __name__ == "__main__":
    main()
