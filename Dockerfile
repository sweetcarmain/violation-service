FROM ghcr.io/puppeteer/puppeteer:20.8.2

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci
COPY . .

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

CMD [ "node", "server.js" ]
