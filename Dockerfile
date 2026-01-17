FROM oven/bun:1.3-debian AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY . .
RUN bun db:gen

FROM oven/bun:1.3-debian AS runtime
WORKDIR /app

# Ensure CA certificates are up to date
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
  update-ca-certificates && \
  rm -rf /var/lib/apt/lists/*

# Copy node_modules and built application
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

CMD ["bun", "run", "src/index.ts"]
