import React from "react";
import { useNavigate } from "react-router-dom";


function Dashboard() {

    const navigate = useNavigate();

    const username = localStorage.getItem("username");


    const handleLogout = () => {

        localStorage.removeItem("token");

        localStorage.removeItem("username");

        navigate("/");

    };


    return (

        <div className="dashboard">

            <h1>
                Welcome, {username}! 🎉
            </h1>

            <p>
                You have successfully logged in.
            </p>


            <button onClick={handleLogout}>
                Logout
            </button>

        </div>

    );
}


export default Dashboard;