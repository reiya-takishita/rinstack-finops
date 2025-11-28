FROM node:22.0-alpine
ENV TZ=Asia/Tokyo

WORKDIR /rinstack_base

# disable npm update check
ENV NO_UPDATE_NOTIFIER true
RUN apk update && apk upgrade
RUN apk add git

# make sure we have correct pnpm
RUN npm install -g pnpm@9.0.6

# copy package.json and pnpm-lock.yaml
COPY package.json .
COPY pnpm-lock.yaml .

# 依存関係をインストール
RUN pnpm install

# copy TypeScript source to the container
COPY . .

RUN chmod +x docker/entrypoint.sh
ENTRYPOINT ["/rinstack_base/docker/entrypoint.sh"]

EXPOSE 7070

CMD ["pnpm", "start","-H","0.0.0.0"]