# Imagen base con Node
FROM node:18-bullseye

# Instala unzip
RUN apt-get update && apt-get install -y unzip

# Instala dependencias necesarias para que Chromium corra
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Crea directorio de trabajo
WORKDIR /app

# Copia dependencias
COPY package*.json ./

# Instala dependencias (incluyendo puppeteer que trae Chromium)
RUN npm install

# Copia el resto de la app
COPY . .

# Expone el puerto (ajusta si tu app usa otro)
EXPOSE 3000

# Comando de arranque
CMD ["npm", "start"]
