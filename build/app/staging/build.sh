#!/bin/bash

# AWS_PROFILE=tqm ./build/app/staging/build.sh

aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin 631550694525.dkr.ecr.ap-northeast-1.amazonaws.com
docker build --no-cache -t rinstack_base -f build/app/Dockerfile.slim --build-arg ENV=staging .
docker tag rinstack_base:latest 631550694525.dkr.ecr.ap-northeast-1.amazonaws.com/rinstack_base:staging
docker push 631550694525.dkr.ecr.ap-northeast-1.amazonaws.com/rinstack_base:staging
