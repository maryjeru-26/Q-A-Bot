import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";


function Login() {

    const navigate = useNavigate();


    const [formData, setFormData] = useState({
        email: "",
        password: ""
    });


    const [message, setMessage] = useState("");


    const handleChange = (e) => {

        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });

    };


    const handleSubmit = async (e) => {

        e.preventDefault();

        setMessage("");


        try {

            const response = await fetch(
                "http://127.0.0.1:8000/login",
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify(formData)
                }
            );


            const data = await response.json();


            if (!response.ok) {

                if (Array.isArray(data.detail)) {

                    setMessage(data.detail[0].msg);

                } else {

                    setMessage(data.detail || "Login failed");

                }

                return;
            }


            localStorage.setItem(
                "token",
                data.token
            );


            localStorage.setItem(
                "username",
                data.username
            );


            navigate("/dashboard");


        } catch (error) {

            console.error("Login error:", error);

            setMessage(
                "Unable to connect to server. Make sure FastAPI is running."
            );

        }

    };


    return (

        <div className="auth-container">

            <div className="auth-box">

                <h2>Login</h2>


                <form onSubmit={handleSubmit}>

                    <input
                        type="email"
                        name="email"
                        placeholder="Email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                    />


                    <input
                        type="password"
                        name="password"
                        placeholder="Password"
                        value={formData.password}
                        onChange={handleChange}
                        required
                    />


                    <button type="submit">
                        Login
                    </button>

                </form>


                {message && (
                    <p>{message}</p>
                )}


                <p>

                    Don't have an account?{" "}

                    <Link to="/register">
                        Register
                    </Link>

                </p>

            </div>

        </div>

    );
}


export default Login;