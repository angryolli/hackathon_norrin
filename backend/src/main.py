from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Hackathon Norrin API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str


class EchoRequest(BaseModel):
    message: str


class EchoResponse(BaseModel):
    echo: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/echo", response_model=EchoResponse)
def echo(body: EchoRequest) -> EchoResponse:
    return EchoResponse(echo=body.message)
