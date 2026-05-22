# Usa una imagen oficial de Node.js como imagen base
FROM node:21-alpine

# 1. Instalar OpenSSL (Obligatorio para que el motor de Prisma funcione en Alpine)
RUN apk add --no-cache openssl

# Establece el directorio de trabajo
WORKDIR /src/app
                    
# Copia los archivos de definición de dependencias
COPY package*.json ./

# 2. Instala TODAS las dependencias (necesario para tener el CLI de Prisma disponible)
RUN npm install

# 3. Copia el resto de la aplicación (incluyendo tu carpeta /prisma con el schema)
COPY . .

# 4. Genera el cliente de Prisma dentro del contenedor
RUN npx prisma generate

# 5. Elimina las dependencias de desarrollo para que la imagen final sea ligera
RUN npm prune --omit=dev

# Comando para ejecutar la aplicación
CMD [ "npm", "start" ]