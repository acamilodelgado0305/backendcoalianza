import app from './app.js';
import prisma from './prisma.js';

// BigInt no es serializable por JSON.stringify por defecto (viene de columnas BIGSERIAL)
BigInt.prototype.toJSON = function () { return Number(this); };

const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', async () => {
    await prisma.$connect();
    console.log('Servidor escuchando en el puerto', PORT);
    console.log('Prisma conectado a PostgreSQL.');
});
