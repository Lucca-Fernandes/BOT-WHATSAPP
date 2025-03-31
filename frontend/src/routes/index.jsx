import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from '../pages/Login';
import BotInterface from '../pages/BotInterface';

function AppRoutes() {
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';

    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/bot" element={isAuthenticated ? <BotInterface /> : <Navigate to="/login" />} />
            <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
    );
}

export default AppRoutes;