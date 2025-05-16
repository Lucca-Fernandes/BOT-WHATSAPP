export default {
  server: {
    proxy: {
      '/api': {
        target: 'https://bot-whatsapp-rho.vercel.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
};