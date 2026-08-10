import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import TripBoard from "../TripBoard";

vi.mock("../route-viewer", () => ({
  RouteViewer: () => <div data-testid="route-viewer" />,
}));

// lucide-react's ESM build does not resolve under the jsdom/vitest transform
// used here — every named icon comes back undefined, which makes any component
// rendering one blow up with "Element type is invalid". Stand in the icons
// TripBoard uses; none of them carry behaviour worth asserting on.
vi.mock("lucide-react", () => {
  const Icon = () => <span aria-hidden="true" />;

  return {
    CalendarDays: Icon,
    MapPin: Icon,
    NotebookPen: Icon,
    CheckSquare: Icon,
    Pencil: Icon,
    Check: Icon,
    X: Icon,
    Trash2: Icon,
  };
});

global.fetch = vi.fn();

const ITEMS = [
  { id: "item-1", text: "Book the hostel", completed: false },
  { id: "item-2", text: "Carry the printout", completed: false },
];

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

function renderBoard() {
  return render(
    <TripBoard
      meetupPlanId="plan-1"
      title="Goa trip"
      location="Anjuna Beach"
      meetupTime="2026-09-01T10:00:00.000Z"
    />,
  );
}

describe("TripBoard checklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue(
      jsonResponse(ITEMS),
    );
  });

  it("renders the loaded checklist items", async () => {
    renderBoard();

    expect(
      await screen.findByText("Book the hostel"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Carry the printout"),
    ).toBeInTheDocument();
  });

  it("offers a remove control for each item", async () => {
    renderBoard();

    await screen.findByText("Book the hostel");

    expect(
      screen.getByRole("button", {
        name: /remove book the hostel/i,
      }),
    ).toBeInTheDocument();
  });

  it("deletes an item through the API and removes it from the list", async () => {
    renderBoard();

    await screen.findByText("Book the hostel");

    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse({ ok: true }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /remove book the hostel/i,
      }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText("Book the hostel"),
      ).not.toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenLastCalledWith(
      "/api/meetup-checklist?id=item-1",
      expect.objectContaining({ method: "DELETE" }),
    );

    // The other item is untouched.
    expect(
      screen.getByText("Carry the printout"),
    ).toBeInTheDocument();
  });

  it("restores the item and shows the server's message when the delete fails", async () => {
    renderBoard();

    await screen.findByText("Book the hostel");

    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse({ error: "Forbidden" }, false, 403),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /remove book the hostel/i,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Forbidden",
    );
    expect(
      screen.getByText("Book the hostel"),
    ).toBeInTheDocument();
  });

  it("sends the trimmed text when adding an item", async () => {
    renderBoard();

    await screen.findByText("Book the hostel");

    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse({
        id: "item-3",
        text: "Pack sunscreen",
        completed: false,
      }),
    );

    fireEvent.change(
      screen.getByPlaceholderText(/add checklist item/i),
      { target: { value: "   Pack sunscreen   " } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /add item/i }),
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        "/api/meetup-checklist",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            meetupPlanId: "plan-1",
            text: "Pack sunscreen",
          }),
        }),
      );
    });
  });

  it("surfaces the server's error when an add is rejected", async () => {
    renderBoard();

    await screen.findByText("Book the hostel");

    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse(
        { error: "This checklist is full (max 200 items)" },
        false,
        409,
      ),
    );

    fireEvent.change(
      screen.getByPlaceholderText(/add checklist item/i),
      { target: { value: "One too many" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /add item/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /checklist is full/i,
    );
  });

  it("caps how much text the inputs accept", async () => {
    renderBoard();

    await screen.findByText("Book the hostel");

    expect(
      screen.getByPlaceholderText(/add checklist item/i),
    ).toHaveAttribute("maxLength", "200");
  });
});
