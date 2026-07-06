# ArchGuard Gateway

The enterprise-grade serverless backend powering ArchGuard AI. Built on Cloudflare Workers, this gateway handles request ingestion, HMAC signature verification, message queuing, fault-tolerant AI model routing, and secure asynchronous GitHub callbacks.

---

## Technical Architecture

This repository acts as the Server-side Gateway within the ArchGuard ecosystem. It works closely with the client-side GitHub Action runner:
* Client Side (GitHub Action Runner): [archguard-labs/action](https://github.com/archguard-labs/action)
* Server Side (Edge Gateway): [archguard-labs/gateway](https://github.com/archguard-labs/gateway)

```text
+------------------------+
|  GitHub Action Runner  | (Repo 1: archguard-ai)
+-----------+------------+
            |
            | 1. Signed HTTPS POST Request
            |    (HMAC Payload Verification)
            v
+------------------------+
|   Cloudflare Workers   | (Repo 2: archguard-gateway)
|        Gateway         |
+-----------+------------+
            |
            | 2. Push Background Task (<50ms)
            |    (Async Queue Pipeline)
            v
+------------------------+
|   Cloudflare Queues    | (Message Broker)
+-----------+------------+
            |
            | 3. Pull Task & Trigger Inference
            v
+------------------------+
|  AI Core Engine Pool   | (Llama 3.x / Mistral)
+-----------+------------+
            |
            | 4. POST Review Callback
            |    (Asymmetric Webhook)
            v
+------------------------+
|   GitHub PR Comment    | (Automated Architectural Review)
+------------------------+

```
## Core Capabilities

* HMAC Payload Verification: Leverages the high-performance Web Crypto API at the edge to calculate and verify incoming SHA-256 signatures, shielding the gateway from unauthorized traffic and API exhaustion.
* Non-Blocking Ingestion: Decouples intake processing from LLM execution. Accepts incoming Git Diffs and hands them off to Cloudflare Queues in under 50ms, eliminating connection timeouts.
* Resilient Inference Pool: Implements a Circuit Breaker design pattern over an array of serverless LLM models. Automatically triggers an instant rollover to fallback engines if the primary model hits a deprecation or downtime window.
* Secure Callback Processing: Operates completely on a Zero-Data Retention policy. Once the asynchronous consumer processes the pipeline task, it delivers the payload directly back to Octokit REST endpoints and wipes all volatile contexts.

---

## Environment Variables Configuration

To run and deploy this worker, the following variables and secrets must be configured inside your Wrangler environment (`wrangler.json`) or injected via the Cloudflare Dashboard:

| Variable Name | Type | Description |
| :--- | :--- | :--- |
| `SHARED_SECRET` | Secret | The symmetric key used to compute and verify the HMAC SHA-256 request signatures originating from the GitHub Runner. |
| `ARCHGUARD_QUEUE` | Binding | The Cloudflare Queue binding name designated as the asynchronous message broker buffer. |

## Local Development & Testing

You can spin up a local Cloudflare Edge environment to test the full End-to-End workflow (Authentication -> Queue -> AI Inference) without deploying to production or using a real GitHub PR.

### Quick Start
1. **Start the Local Gateway**:
   ```bash
   npm run dev
   ```
   *This starts Wrangler locally on `http://127.0.0.1:8787` and connects to the remote AI models for inference.*

2. **Trigger the E2E Test**:
   Open a second terminal window and run:
   ```bash
   npm run test:e2e
   ```
   *This script acts like the GitHub Action. It generates a fake PR diff, signs it with HMAC, and pushes it to your local Gateway. Watch the Wrangler terminal to see the AI process the queue!*

## Live Progress Tracking

This project is actively moving from its validated Proof of Concept (POC) state into a reliable open-source product. The active roadmap, sprint breakdowns, and technical tasks are monitored publicly on our [Trello Board](https://trello.com/b/QH0sQ7EJ/archguard-ai).

---

## Contributing and Support

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are greatly appreciated.

Feel free to fork the repository, open an issue, or submit a Pull Request.

*Maintained by Pau Dang — "Don't let the framework own you. Choose your architecture, build your standards."*
