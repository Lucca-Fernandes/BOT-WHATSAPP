import React, { useState } from 'react';
import { TextField, Button, Typography, Box, Alert, CircularProgress } from '@mui/material';

function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        setTimeout(() => {
            const validUsername = 'admin';
            const validPassword = '123456';

            if (username === validUsername && password === validPassword) {
                localStorage.setItem('isAuthenticated', 'true');
                window.location.href = '/bot';
            } else {
                setError('Usuário ou senha incorretos');
            }
            setIsLoading(false);
        }, 1000);
    };

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                backgroundColor: '#f0f0f0',
            }}
        >
            <Box
                sx={{
                    width: 400,
                    p: 4,
                    backgroundColor: 'white',
                    borderRadius: 2,
                    boxShadow: 3,
                    textAlign: 'center',
                }}
            >
                <Typography variant="h5" gutterBottom>
                    Login
                </Typography>
                <form onSubmit={handleSubmit}>
                    <TextField
                        label="Usuário"
                        variant="outlined"
                        fullWidth
                        margin="normal"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        disabled={isLoading}
                    />
                    <TextField
                        label="Senha"
                        type="password"
                        variant="outlined"
                        fullWidth
                        margin="normal"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={isLoading}
                    />
                    {error && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            {error}
                        </Alert>
                    )}
                    <Button
                        type="submit"
                        variant="contained"
                        color="primary"
                        fullWidth
                        sx={{ mt: 2 }}
                        disabled={isLoading}
                    >
                        {isLoading ? <CircularProgress size={24} /> : 'Entrar'}
                    </Button>
                </form>
            </Box>
        </Box>
    );
}

export default Login;