#!/usr/bin/env python3
"""Build an isolated Docker stack, run Python integration tests, then clean up."""
import argparse
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_suite(startup_timeout=300):
    if not shutil.which("docker"):
        print("Docker is not installed or not on PATH. Start Docker Desktop and retry.", file=sys.stderr)
        return 2
    project = "catalog-it-" + uuid.uuid4().hex[:12]
    compose = ["docker", "compose", "--project-name", project, "--file", str(ROOT / "compose.integration.yaml")]
    result = 0
    started = False

    def run(arguments, timeout=1800):
        subprocess.run(compose + arguments, cwd=ROOT, check=True, timeout=timeout)

    try:
        subprocess.run(["docker", "info"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        run(["config", "--quiet"], timeout=30)
        print(f"Starting disposable stack {project}. Working catalogue is not modified.", flush=True)
        started = True
        run(["up", "--build", "--wait", "--wait-timeout", str(startup_timeout), "web"])
        run(["run", "--rm", "--build", "tests"], timeout=600)
        run(["run", "--rm", "tests", "python", "persistence_probe.py", "write"], timeout=60)
        run(["run", "--rm", "init"], timeout=180)
        run(["restart", "web"], timeout=60)
        run(["up", "--wait", "--wait-timeout", str(startup_timeout), "web"], timeout=startup_timeout + 30)
        run(["run", "--rm", "tests", "python", "persistence_probe.py", "verify"], timeout=60)
        print("PASS: Python HTTP/PostgreSQL/S3 tests and restart verification.", flush=True)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as error:
        print(f"Integration run failed: {error}", file=sys.stderr)
        result = 1
        if started:
            subprocess.run(compose + ["logs", "--no-color", "--tail", "60", "init", "web", "minio"], cwd=ROOT, timeout=30, check=False)
    except KeyboardInterrupt:
        print("Interrupted; removing the disposable stack.", file=sys.stderr)
        result = 130
    finally:
        if started:
            try:
                cleanup = subprocess.run(compose + ["down", "--volumes", "--remove-orphans"], cwd=ROOT, timeout=120, check=False)
                if cleanup.returncode:
                    result = result or 1
                    print(f"Cleanup failed. Retry: {' '.join(compose)} down --volumes --remove-orphans", file=sys.stderr)
            except (OSError, subprocess.TimeoutExpired):
                result = result or 1
                print(f"Cleanup incomplete. Retry: {' '.join(compose)} down --volumes --remove-orphans", file=sys.stderr)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--startup-timeout", type=int, default=300, help="Seconds to wait for healthy containers after building (default 300).")
    args = parser.parse_args()
    if args.startup_timeout < 1:
        parser.error("--startup-timeout must be positive")
    return run_suite(args.startup_timeout)


if __name__ == "__main__":
    sys.exit(main())
