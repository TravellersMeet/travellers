import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TicketUploadForm from "../ticket-upload-form";

global.fetch = vi.fn();

describe("TicketUploadForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ticket: { id: "ticket-1" } }),
    });
  });

  it("disables submit button while request is pending", async () => {
    let resolveFetch: (value: Response) => void;
    (global.fetch as any).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    render(<TicketUploadForm />);

    const submitButton = screen.getByRole("button", { name: /upload ticket/i });
    expect(submitButton).not.toBeDisabled();

    // Fill form
    const destinationInput = screen.getByLabelText(/destination city/i);
    const dateInput = screen.getByLabelText(/departure date/i);
    const fileInput = screen.getByLabelText(/ticket \(pdf or image\)/i);

    fireEvent.change(destinationInput, { target: { value: "Paris" } });
    fireEvent.change(dateInput, { target: { value: "2026-08-15" } });

    const file = new File(["ticket"], "ticket.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      writable: false,
    });
    fireEvent.change(fileInput);

    // Submit form
    const form = screen.getByRole("form");
    fireEvent.submit(form);

    // Button should be disabled while loading
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
      expect(screen.getByText(/uploading/i)).toBeInTheDocument();
    });

    // Resolve the fetch
    resolveFetch!(
      new Response(JSON.stringify({ ok: true, ticket: { id: "ticket-1" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    // Button should be re-enabled after completion
    await waitFor(() => {
      expect(screen.getByText(/ticket uploaded/i)).toBeInTheDocument();
    });
  });

  it("re-enables button after failed request", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Upload failed" }),
    });

    render(<TicketUploadForm />);

    const submitButton = screen.getByRole("button", { name: /upload ticket/i });

    // Fill and submit form
    const destinationInput = screen.getByLabelText(/destination city/i);
    const dateInput = screen.getByLabelText(/departure date/i);
    const fileInput = screen.getByLabelText(/ticket \(pdf or image\)/i);

    fireEvent.change(destinationInput, { target: { value: "Paris" } });
    fireEvent.change(dateInput, { target: { value: "2026-08-15" } });

    const file = new File(["ticket"], "ticket.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      writable: false,
    });
    fireEvent.change(fileInput);

    const form = screen.getByRole("form");
    fireEvent.submit(form);

    // Wait for request to complete
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
      expect(screen.getByText(/upload ticket/i)).toBeInTheDocument();
    });
  });

  it("prevents rapid repeated submissions via button state", async () => {
    let callCount = 0;
    (global.fetch as any).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          callCount++;
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ ok: true, ticket: { id: `ticket-${callCount}` } }), {
                status: 201,
                headers: { "Content-Type": "application/json" },
              })
            );
          }, 100);
        })
    );

    render(<TicketUploadForm />);

    const submitButton = screen.getByRole("button", { name: /upload ticket/i });

    // Fill form
    const destinationInput = screen.getByLabelText(/destination city/i);
    const dateInput = screen.getByLabelText(/departure date/i);
    const fileInput = screen.getByLabelText(/ticket \(pdf or image\)/i);

    fireEvent.change(destinationInput, { target: { value: "Paris" } });
    fireEvent.change(dateInput, { target: { value: "2026-08-15" } });

    const file = new File(["ticket"], "ticket.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      writable: false,
    });
    fireEvent.change(fileInput);

    // Submit form multiple times rapidly
    const form = screen.getByRole("form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    // Button should be disabled after first submit
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });

    // Wait for request to complete
    await waitFor(() => {
      expect(callCount).toBe(1); // Only one actual request should be made
    }, { timeout: 500 });
  });

  it("sends Idempotency-Key header with request", async () => {
    render(<TicketUploadForm />);

    // Fill form
    const destinationInput = screen.getByLabelText(/destination city/i);
    const dateInput = screen.getByLabelText(/departure date/i);
    const fileInput = screen.getByLabelText(/ticket \(pdf or image\)/i);

    fireEvent.change(destinationInput, { target: { value: "Paris" } });
    fireEvent.change(dateInput, { target: { value: "2026-08-15" } });

    const file = new File(["ticket"], "ticket.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      writable: false,
    });
    fireEvent.change(fileInput);

    // Submit form
    const form = screen.getByRole("form");
    fireEvent.submit(form);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/tickets",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Idempotency-Key": expect.stringMatching(/^\d+-[a-z0-9]+$/),
          }),
        })
      );
    });
  });
});
