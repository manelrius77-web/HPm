@echo off
start cmd /k "cd /d C:\Users\manel\HPm\backend && uvicorn server:app --reload --port 8001"
start cmd /k "cd /d C:\Users\manel\HPm\frontend && npm run web"