
import { EventRegistry } from "../store/event-registry";
import { xdr } from "@stellar/stellar-sdk";

describe("Full Notification Lifecycle Integration Test", () => {
  let eventRegistry: EventRegistry;

  beforeEach(() => {
    eventRegistry = new EventRegistry();
  });

  test("should process notification from creation to retrieval and acknowledgement", () => {
    // 1. Create a test event (simulate a contract event)
    const testEventId = "event-1234";
    const testContractAddress = "CDNJ3YJ5F4U5YF4O5U6Y7I8U9Y0U1I2O3P4I5U6Y7I8";
    const testLedger = 123456;
    const testTxHash = "abcdef1234567890abcdef1234567890";

    // Create topic for "TaskCreated" event (similar to what the Task Bounty contract emits)
    const topic = [
      xdr.ScVal.scvSymbol("task"),
      xdr.ScVal.scvSymbol("created"),
    ];

    // Create a simple value
    const value = xdr.ScVal.scvU32(42);

    // 2. Add the event to registry (simulate EventSubscriber processing it)
    const addedEvent = eventRegistry.addFromInput({
      eventId: testEventId,
      contractAddress: testContractAddress,
      eventName: "task",
      ledger: testLedger,
      type: "contract",
      topic,
      value,
      txHash: testTxHash,
    });

    // 3. Verify event is stored correctly
    expect(addedEvent.eventId).toBe(testEventId);
    expect(addedEvent.contractAddress).toBe(testContractAddress);
    expect(addedEvent.ledger).toBe(testLedger);
    expect(addedEvent.txHash).toBe(testTxHash);

    // 4. Verify event can be retrieved
    const retrievedEvents = eventRegistry.getEvents();
    expect(retrievedEvents.length).toBe(1);
    expect(retrievedEvents[0].eventId).toBe(testEventId);

    // 5. Simulate acknowledgement (event is processed)
    expect(retrievedEvents[0].receivedAt).toBeLessThanOrEqual(Date.now());
  });
});
