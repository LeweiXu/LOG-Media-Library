from fastapi import FastAPI
from sqlalchemy import create_engine

app = FastAPI()

DATABASE_URL = "postgresql+psycopg2://username:password@localhost/dbname"
engine = create_engine(DATABASE_URL)

@app.get("/")
def read_root():
    return {"Hello": "World"}