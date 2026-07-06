# Security Policy

## Supported Versions

Currently, only the latest major release (`v1.x`) is actively supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| v1.x    | :white_check_mark: |
| < v1.0  | :x:                |

## Zero-Trust Architecture

ArchGuard AI is designed with a **Zero-Trust, Zero-Data-Retention** architecture. 
- It uses GitHub OIDC (OpenID Connect) for authentication, eliminating the need for long-lived API keys or secrets in the Free Tier.
- All AI inferences are stateless. Neither ArchGuard nor Cloudflare retains any source code diffs or API keys passed through the Gateway.

## Reporting a Vulnerability

If you discover a vulnerability in ArchGuard AI, we would like to know about it so we can take steps to address it as quickly as possible.

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please send an email to `security@archguard-labs.com`. We will strive to acknowledge your report within 48 hours and will keep you informed of our progress towards a fix.
