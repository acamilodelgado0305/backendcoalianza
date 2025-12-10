# Usa una imagen oficial de Node.js como imagen base
FROM node:21-alpine

# Establece el directorio de trabajo
WORKDIR /usr/src/app

# Copia los archivos de definición de dependencias
COPY package*.json ./

# Instala las dependencias de producción (omite las de desarrollo)
RUN npm install --omit=dev

# Copia el resto de la aplicación
COPY . .

# Comando para ejecutar la aplicación
CMD [ "npm", "start" ]