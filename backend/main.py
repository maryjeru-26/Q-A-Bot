from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from database import users_collection
from models import UserRegister, UserLogin
from auth import hash_password, verify_password, create_token


app = FastAPI()




app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)




@app.get("/")
def home():
    return {
        "message": "FastAPI server is running"
    }




@app.post("/register")
def register(user: UserRegister):

    existing_user = users_collection.find_one({
        "email": user.email
    })

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Email already registered"
        )

    hashed_password = hash_password(user.password)

    new_user = {
        "username": user.username,
        "email": user.email,
        "password": hashed_password
    }

    result = users_collection.insert_one(new_user)

    return {
        "message": "Registration successful",
        "user_id": str(result.inserted_id)
    }




@app.post("/login")
def login(user: UserLogin):

    existing_user = users_collection.find_one({
        "email": user.email
    })

    if not existing_user:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    password_correct = verify_password(
        user.password,
        existing_user["password"]
    )

    if not password_correct:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    token = create_token(
        str(existing_user["_id"]),
        existing_user["username"]
    )

    return {
        "message": "Login successful",
        "token": token,
        "username": existing_user["username"]
    }