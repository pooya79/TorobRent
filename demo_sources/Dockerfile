FROM python:3.14.2-alpine AS generator

ARG DEMO_BASE_DOMAIN=demo.example.com
WORKDIR /src
COPY demo_sources /src/demo_sources
RUN python /src/demo_sources/generate.py \
    --base-domain "${DEMO_BASE_DOMAIN}" \
    --output /generated

FROM nginx:1.30.4-alpine

COPY --from=generator /generated /usr/share/nginx/html
COPY demo_sources/nginx/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
