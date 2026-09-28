@echo off
sonar-scanner ^
-Dsonar.projectKey=my-crm-app ^
-Dsonar.sources=. ^
-Dsonar.host.url=http://localhost:9000 ^
-Dsonar.login=your_sonarqube_token