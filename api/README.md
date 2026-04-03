This folder contains the API endpoints for OpenClaw Mission Control. Each file corresponds to a specific endpoint or group of related endpoints. The endpoints are designed to allow users to interact with the OpenClaw system, manage missions, and retrieve data.

For the api endpoints in this folder, the base path is `/api/mission-control`. For example, if there is an endpoint defined in `mission-control.ts` with the path `/logs`, it would be accessible at `/api/mission-control/logs`.

The following api endpoints are currently implemented:
- `/logs`: Retrieves the mission control logs of the OpenClaw system (different from the OpenClaw logs).
- `/health`: Checks the health status of the OpenClaw mission control system.
