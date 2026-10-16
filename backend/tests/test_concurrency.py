"""The UI fires several requests at once (rig, analysis, catalog). The backend must serve
them concurrently without sharing a SQLite cursor across threads."""

from concurrent.futures import ThreadPoolExecutor


def test_parallel_requests_do_not_corrupt_db_access(client):
    rig_id = client.post("/api/rigs", json={"name": "parallel", "from_demo": True}).json()["id"]
    paths = [f"/api/rigs/{rig_id}", f"/api/rigs/{rig_id}/analysis", "/api/catalog/devices", "/api/rigs"] * 6

    def hit(path: str) -> int:
        return client.get(path).status_code

    for _ in range(5):
        with ThreadPoolExecutor(max_workers=8) as ex:
            codes = list(ex.map(hit, paths))
        assert codes == [200] * len(paths), codes
