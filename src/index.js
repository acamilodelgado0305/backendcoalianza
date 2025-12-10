import app from './app.js';
import './database.js';

const PORT = process.env.PORT || 8080;  // 👈 Cloud Run pone este PORT

app.listen(PORT, '0.0.0.0', () => {
    console.log('Servidor escuchando en el puerto', PORT);
});
