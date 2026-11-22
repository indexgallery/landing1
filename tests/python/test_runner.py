"""Host-side checks for runner cleanup; these do not replace the real suite."""
import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("integration_runner", Path(__file__).resolve().parents[2] / "scripts" / "test_integration.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class RunnerLifecycle(unittest.TestCase):
    @patch.object(runner.shutil, "which", return_value=None)
    def test_missing_docker_returns_failure_without_starting_anything(self, _):
        with patch.object(runner.subprocess, "run") as command:
            self.assertEqual(runner.run_suite(), 2)
            command.assert_not_called()

    def exercise(self, failure=None):
        calls = []

        def command(args, **kwargs):
            calls.append(args)
            if failure == "tests" and "tests" in args and "--build" in args:
                raise subprocess.CalledProcessError(7, args)
            if failure == "startup" and "up" in args:
                raise subprocess.CalledProcessError(1, args)
            if failure == "interrupted" and "up" in args:
                raise KeyboardInterrupt
            return subprocess.CompletedProcess(args, 0)

        with patch.object(runner.shutil, "which", return_value="/usr/bin/docker"), patch.object(runner.subprocess, "run", side_effect=command):
            result = runner.run_suite()
        compose_calls = [args for args in calls if "--project-name" in args]
        projects = {args[args.index("--project-name") + 1] for args in compose_calls}
        self.assertEqual(len(projects), 1)
        self.assertTrue(next(iter(projects)).startswith("catalog-it-"))
        self.assertEqual(compose_calls[-1][-3:], ["down", "--volumes", "--remove-orphans"])
        self.assertTrue(all("compose.integration.yaml" in " ".join(args) for args in compose_calls))
        return result, compose_calls

    def test_success_runs_tests_seed_restart_and_cleanup(self):
        result, calls = self.exercise()
        self.assertEqual(result, 0)
        self.assertTrue(any(args[-2:] == ["restart", "web"] for args in calls))
        self.assertTrue(any(args[-1] == "verify" for args in calls))

    def test_failing_tests_still_clean_up_and_return_failure(self):
        self.assertEqual(self.exercise("tests")[0], 1)

    def test_startup_failure_still_cleans_up(self):
        self.assertEqual(self.exercise("startup")[0], 1)

    def test_ctrl_c_still_cleans_up(self):
        self.assertEqual(self.exercise("interrupted")[0], 130)


if __name__ == "__main__":
    unittest.main()
