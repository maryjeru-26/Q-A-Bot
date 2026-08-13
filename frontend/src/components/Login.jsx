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

            <section className="auth-intro">
                <div className="auth-brand"><span>✦</span> Paperwise</div>
                <div className="auth-copy"><p className="eyebrow">Drug-label intelligence, made clear</p><h1>Ask better questions about your prescribing documents.</h1><p>Upload a drug label, ask in plain language, and get grounded answers with the exact source page—without replacing professional medical advice.</p></div>
                <div className="feature-list"><div><b>◈ PDF-grounded answers</b><span>Answers stay tied to your uploaded documents.</span></div><div><b>◈ Exact page sources</b><span>Open the cited page and inspect the highlighted evidence.</span></div><div><b>◈ Private conversations</b><span>Your documents, chats, and analytics stay isolated to your account.</span></div></div>
                <p className="auth-note">For drug-information reference only. Always consult a qualified healthcare professional for personal medical decisions.</p>
            </section>
            <div className="auth-panel"><div className="auth-box">

                <p className="eyebrow">Welcome back</p><h2>Sign in to Paperwise</h2><p className="auth-subtitle">Continue your document conversations.</p>


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

            </div></div>

        </div>

    );
}


export default Login;
