import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";


function Register() {

    const navigate = useNavigate();

    const [formData, setFormData] = useState({
        username: "",
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
                "http://127.0.0.1:8000/register",
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

                    setMessage(data.detail || "Registration failed");

                }

                return;
            }


            setMessage("Registration successful!");

            setTimeout(() => {

                navigate("/");

            }, 1000);


        } catch (error) {

            console.error("Registration error:", error);

            setMessage(
                "Unable to connect to server. Make sure FastAPI is running."
            );

        }
    };


    return (

        <div className="auth-container">

            <div className="auth-box">

                <h2>Create Account</h2>


                <form onSubmit={handleSubmit}>

                    <input
                        type="text"
                        name="username"
                        placeholder="Username"
                        value={formData.username}
                        onChange={handleChange}
                        required
                    />


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
                        Register
                    </button>

                </form>


                {message && (
                    <p>{message}</p>
                )}


                <p>

                    Already have an account?{" "}

                    <Link to="/">
                        Login
                    </Link>

                </p>

            </div>

        </div>

    );
}


export default Register;