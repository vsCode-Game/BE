# 1. Node.js 기반 이미지 설정 (NestJS 실행 환경)
FROM node:20

# 2. 작업 디렉토리 설정
WORKDIR /usr/src/app

# 3. 의존성 파일(package.json 및 package-lock.json) 복사
COPY package*.json ./

# 4. npm 패키지 설치
RUN npm install

# 5. 소스 코드 복사
COPY . .

# 6. NestJS 애플리케이션 빌드 (TypeScript → JavaScript)
RUN npm run build

# 7. 실행 명령어 설정
CMD ["node", "dist/main"]

# 8. 애플리케이션 실행에 사용할 포트 노출
EXPOSE 3000
