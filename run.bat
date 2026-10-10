@echo off
rem Dev runner. Console logs, no installing.   run.bat            -> your real data
rem                                            run.bat --demo     -> fake demo data
cd /d "%~dp0"
if not exist go.sum go mod tidy
go run . --console %*
