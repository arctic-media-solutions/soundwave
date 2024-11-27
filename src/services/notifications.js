import fetch from 'node-fetch';

export class NotificationService {
    constructor(logger) {
        this.logger = logger;
    }

    async sendWebhook(url, data) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error(`Webhook failed with status ${response.status}`);
            }

            return true;
        } catch (error) {
            this.logger.error('Webhook notification failed:', error);
            return false;
        }
    }

    async sendSlackNotification(webhookUrl, message) {
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: message,
                    blocks: [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: message
                            }
                        }
                    ]
                })
            });

            if (!response.ok) {
                throw new Error(`Slack notification failed with status ${response.status}`);
            }

            return true;
        } catch (error) {
            this.logger.error('Slack notification failed:', error);
            return false;
        }
    }

    async notify(notifications, data) {
        if (!notifications) return;

        const promises = [];

        if (data.status === 'completed') {
            if (notifications.webhook_url) {
                promises.push(this.sendWebhook(notifications.webhook_url, data));
            }
            if (notifications.slack_webhook_url) {
                const message = `✅ Audio processing completed\nJob ID: ${data.job_id}\nInternal ID: ${data.internal_id}\nOutputs: ${data.outputs.length}`;
                promises.push(this.sendSlackNotification(notifications.slack_webhook_url, message));
            }
        } else if (data.status === 'failed') {
            if (notifications.error_webhook_url) {
                promises.push(this.sendWebhook(notifications.error_webhook_url, data));
            }
            if (notifications.slack_webhook_url) {
                const message = `❌ Audio processing failed\nJob ID: ${data.job_id}\nInternal ID: ${data.internal_id}\nError: ${data.error}`;
                promises.push(this.sendSlackNotification(notifications.slack_webhook_url, message));
            }
        } else if (data.status === 'processing' && notifications.progress_webhook_url) {
            promises.push(this.sendWebhook(notifications.progress_webhook_url, data));
        }

        if (promises.length > 0) {
            await Promise.allSettled(promises);
        }
    }
}