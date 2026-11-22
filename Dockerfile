FROM node:22-alpine

WORKDIR /app

# Copy all website code and initial default data
COPY . /app

# Keep a pristine copy of the default content.js outside /app/data so that
# when /app/data is bind-mounted as an empty host directory on first run,
# server.js automatically seeds /app/data/content.js without overwriting existing CMS data.
RUN mkdir -p /app/data-seed /app/data /app/uploads && \
    cp /app/data/content.js /app/data-seed/content.js

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
