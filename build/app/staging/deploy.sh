#!/bin/bash

# AWS_PROFILE=tqm ./build/app/staging/deploy.sh

aws ecs update-service --cluster rinstack-staging --service rinstack-staging-web --force-new-deployment --region ap-northeast-1
