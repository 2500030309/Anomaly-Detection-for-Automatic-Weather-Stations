"""
SkyGuard AI - Runner Script
Launches the FastAPI backend and serves the interactive SIH demonstration dashboard.
"""

import sys
import uvicorn

if __name__ == "__main__":
    print("=" * 70)
    print("   SKYGUARD AI: REAL-TIME ANOMALY DETECTION FOR AWS (PS ID 26073)   ")
    print("   Team PralayDisha (DIS05) - Smart India Hackathon Prototype      ")
    print("=" * 70)
    print(">> Starting FastAPI server & live WebSocket stream...")
    print(">> Open your browser at: http://localhost:8000")
    print(">> Swagger API Docs:      http://localhost:8000/docs")
    print("=" * 70)
    
    uvicorn.run("backend.api:app", host="127.0.0.1", port=8000, reload=False)
