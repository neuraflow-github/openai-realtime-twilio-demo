# GitHub Actions for Railway Deployment

## Setup Instructions

1. **Get your Railway Project Token:**
   - Go to your Railway project dashboard
   - Navigate to Settings → Tokens
   - Create a new token with deployment permissions
   - Copy the token (you'll only see it once)

2. **Add the token to GitHub Secrets:**
   - Go to your GitHub repository
   - Navigate to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `RAILWAY_TOKEN`
   - Value: Paste your Railway token
   - Click "Add secret"

3. **Test the deployment:**
   - Push a commit to the `main` branch
   - Check the Actions tab in GitHub to monitor the deployment
   - Verify the deployment in your Railway dashboard

## Workflow Details

The workflow triggers on:
- Every push to the `main` branch
- Pull request events (opened, synchronize)

It uses the Railway CLI to deploy your project automatically.