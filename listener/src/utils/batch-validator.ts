import * as fs from 'fs';
import * as path from 'path';

export interface NotificationPayload {
  id: string;
  recipient: string;
  channel: 'discord' | 'webhook' | 'email';
  message: string;
}

export interface BatchValidationResult {
  isValid: boolean;
  processedCount: number;
  errors: string[];
}

export class BatchValidator {
  public static validateBatch(batch: any[]): BatchValidationResult {
    const result: BatchValidationResult = { isValid: true, processedCount: 0, errors: [] };
    const seenRecipients = new Set<string>();

    if (!Array.isArray(batch) || batch.length === 0) {
      result.errors.push("Invalid batch structure: Batch must be a non-empty array.");
      result.isValid = false;
      return result;
    }

    batch.forEach((payload, index) => {
      const locationId = `Item at index [${index}]`;

      if (!payload.id || !payload.recipient || !payload.channel || !payload.message) {
        result.errors.push(`${locationId}: Missing required fields. (Must contain 'id', 'recipient', 'channel', 'message')`);
        result.isValid = false;
        return;
      }

      if (seenRecipients.has(payload.recipient)) {
        result.errors.push(`${locationId}: Duplicate recipient detected ('${payload.recipient}'). Batch throttling enforced.`);
        result.isValid = false;
      } else {
        seenRecipients.add(payload.recipient);
      }
    });

    if (result.isValid) {
      result.processedCount = batch.length;
    }

    return result;
  }
}

function runTerminalSimulation() {
  const sampleMockBatch = [
    { id: "evt_001", recipient: "discord_channel_alpha", channel: "discord", message: "TaskCreated: Bounty #42 active." },
    { id: "evt_002", recipient: "discord_channel_alpha", channel: "discord", message: "WorkSubmitted: Task completed." },
    { id: "evt_003", recipient: "", channel: "webhook", message: "Missing recipient details" }
  ];

  console.log("🚀 Running NotifyChain Batch Validation Check...");
  const validationReport = BatchValidator.validateBatch(sampleMockBatch);

  const reportsDir = path.join(__dirname, '../../reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(reportsDir, 'last-validation-run.json'),
    JSON.stringify(validationReport, null, 2),
    'utf-8'
  );

  console.log(`\n📊 Execution Results Logged:`);
  console.log(`   Status: ${validationReport.isValid ? '🟩 PASSED' : '🟥 REJECTED'}`);
  console.log(`   Errors Found: ${validationReport.errors.length}`);
  validationReport.errors.forEach(err => console.log(`   ⚠️  ${err}`));
  console.log(`\n💾 Saved audit report to: listener/reports/last-validation-run.json`);
}

if (require.main === module) {
  runTerminalSimulation();
}
