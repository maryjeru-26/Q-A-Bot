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

            <section className="auth-intro">
                <div className="auth-brand"><span>✦</span> Paperwise</div>
                <div className="auth-copy"><p className="eyebrow">Grounded drug information</p><h1>Bring clarity to complex prescribing documents.</h1><p>Paperwise searches only the PDFs you choose, maintains your conversation context, and links each answer back to the source page.</p></div>
                <div className="feature-list"><div><b>01 · Upload drug PDFs</b><span>Index your own prescribing information securely.</span></div><div><b>02 · Ask focused questions</b><span>Explore dosage, warnings, interactions, and more.</span></div><div><b>03 · Verify every answer</b><span>Review the cited source page before making decisions.</span></div></div>
                <p className="auth-note">Paperwise is an information tool, not a diagnostic or treatment service.</p>
            </section>
            <div className="auth-panel"><div className="auth-box">

                <p className="eyebrow">Create your workspace</p><h2>Get started</h2><p className="auth-subtitle">Save private, source-backed document chats.</p>


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

            </div></div>

        </div>

    );
}


export default Register;
