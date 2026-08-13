import os

import bcrypt
import jwt

from datetime import datetime, timedelta
from dotenv import load_dotenv


load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET")

ALGORITHM = "HS256"


def hash_password(password: str):

    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt()
    ).decode("utf-8")


def verify_password(password: str, hashed_password: str):

    return bcrypt.checkpw(
        password.encode("utf-8"),
        hashed_password.encode("utf-8")
    )


def create_token(user_id: str, username: str):

    payload = {
        "user_id": user_id,
        "username": username,
        "exp": datetime.utcnow() + timedelta(hours=1)
    }

    token = jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=ALGORITHM
    )

    return token