# AWS CLI2 を利用するDockerfile
FROM python:3.9

# 前提パッケージのインストール
RUN apt-get update && apt-get install -y less vim curl unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# aws cli v2 のインストール
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip ./aws

WORKDIR /workdir
