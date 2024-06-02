FROM agentaai/templates_v2:main

WORKDIR /app

COPY . .

RUN pip install --no-cache-dir --disable-pip-version-check -U agenta
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt

EXPOSE 80

RUN ["chmod", "+x", "./entrypoint.sh"]
CMD ["./entrypoint.sh"]
