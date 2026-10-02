import asyncio
import websockets
import json

async def test():
    async with websockets.connect("ws://127.0.0.1:8000/ws/telemetry") as ws:
        msg = await ws.recv()
        data = json.loads(msg)
        print("WS Live Verified! Payload Type:", data.get("type"), "| Stations:", len(data.get("stations", [])))

if __name__ == "__main__":
    asyncio.run(test())
