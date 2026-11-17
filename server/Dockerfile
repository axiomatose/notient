FROM node:26-slim

# Install dependencies for better-sqlite3 and argon2
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The 'node' user in the node image has UID 1000
COPY --chown=node:node package*.json ./

# Install dependencies (ignoring scripts initially to speed up)
# Then rebuild native modules to ensure they match the container architecture
RUN npm install && npm rebuild better-sqlite3 argon2

# Copy the rest of the application code
# .dockerignore will prevent copying host node_modules
COPY --chown=node:node . .

# The web app, when the image was built with one (CI puts it in web-dist/).
# The API serves it from the same address.

# Ensure data directory exists and is writable by the node user
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

# Expose the API port
EXPOSE 3301

# Start the application
CMD ["sh", "-c", "if [ -f web-dist/index.html ]; then export WEB_DIST=\"$PWD/web-dist\"; fi; exec npm start"]
