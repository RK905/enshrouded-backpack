# Enshrouded backpack tool. Adds items into empty slots only.
import json
import os
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

def bundle_dir():
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def home_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


BUNDLE = bundle_dir()
HOME = home_dir()
ENGINE = os.path.join(BUNDLE, "engine")
CATALOG_PATH = os.path.join(ENGINE, "data", "itemdb2.json")
ICON_DIR = os.path.join(ENGINE, "data", "icons")
NODE_BAG = os.path.join(ENGINE, "bag.js")
NODE_ADD = os.path.join(ENGINE, "add.js")
NODE_RESTORE = os.path.join(ENGINE, "restore.js")
DEFAULT_CHARACTER = r"C:\Program Files (x86)\Steam\userdata\428884401\1203620\remote\character0.ksd"

BG = "#12100e"
PANEL = "#1c1814"
PANEL2 = "#272119"
LINE = "#3c3226"
TEXT = "#f4ecdf"
MUTED = "#b3a28c"
GOLD = "#e0b15a"
INK = "#1a140c"
SELECT = "#4a3b24"
RARITY_COLORS = ["#d9d3c7", "#7dcea0", "#7eb6e0", "#c59be0", "#e0b15a"]
LIST_ICON = 56


def find_character():
    if os.path.isfile(DEFAULT_CHARACTER):
        return DEFAULT_CHARACTER
    roots = [
        r"C:\Program Files (x86)\Steam\userdata",
        r"C:\Program Files\Steam\userdata",
        r"D:\SteamLibrary\steamapps\userdata",
    ]
    for root in roots:
        if not os.path.isdir(root):
            continue
        for account in os.listdir(root):
            path = os.path.join(root, account, "1203620", "remote", "character0.ksd")
            if os.path.isfile(path):
                return path
    return DEFAULT_CHARACTER


def node_binary():
    bundled = os.path.join(BUNDLE, "node.exe")
    if os.path.isfile(bundled):
        return bundled
    return "node"


def run_node(script, args):
    env = os.environ.copy()
    env["BACKPACK_HOME"] = HOME
    completed = subprocess.run(
        [node_binary(), script, *args],
        cwd=HOME,
        env=env,
        capture_output=True,
        text=True,
    )
    text = (completed.stdout or "").strip().splitlines()
    payload = text[-1] if text else ""
    try:
        data = json.loads(payload) if payload else {"ok": False, "error": completed.stderr.strip() or "No response from the save tool."}
    except json.JSONDecodeError:
        data = {"ok": False, "error": (completed.stderr or completed.stdout or "The save tool failed.").strip()}
    if completed.returncode != 0 and data.get("ok", False):
        data = {"ok": False, "error": data.get("error") or "The save tool failed."}
    return data


def pretty_category(name):
    if not name:
        return ""
    spaced = []
    for index, char in enumerate(name):
        if index and char.isupper() and not name[index - 1].isupper():
            spaced.append(" ")
        spaced.append(char)
    return "".join(spaced)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Enshrouded Backpack")
        self.geometry("1380x860")
        self.minsize(1100, 700)
        self.configure(bg=BG)
        self.catalog = []
        self.by_id = {}
        self.pending = []
        self.free_slots = []
        self.bag_lookup = {}
        self.shown = None
        self.photos = {"list": {}, "detail": {}}
        self.blanks = {}
        self._filter_job = None
        self._working = False
        self.character = tk.StringVar(value=find_character())
        self.search = tk.StringVar()
        self.category = tk.StringVar(value="All")
        self.quantity = tk.IntVar(value=1)
        self.status = tk.StringVar(value="Loading the item catalog.")
        self._load_catalog()
        self._theme()
        self._build()
        self.search.trace_add("write", self._schedule_filter)
        self.category.trace_add("write", lambda *_: self._fill_catalog())
        self.after(200, self.refresh_bag)

    def _load_catalog(self):
        with open(CATALOG_PATH, encoding="utf-8") as handle:
            db = json.load(handle)
        cats = db["cats"]
        rars = db["rars"]
        rows = []
        for hex_id, row in db["items"].items():
            max_stack = int(row[3])
            if max_stack < 1:
                continue
            rarity_index = row[2] if isinstance(row[2], int) else 0
            item = {
                "id": hex_id,
                "name": row[0],
                "category": cats[row[1]] if row[1] < len(cats) else "",
                "rarity": rars[rarity_index] if 0 <= rarity_index < len(rars) else "",
                "rarity_index": rarity_index,
                "max": max_stack,
                "desc": (row[12] or "").strip(),
            }
            rows.append(item)
            self.by_id[hex_id] = item
        rows.sort(key=lambda item: (item["name"].lower(), item["category"]))
        self.catalog = rows
        self.categories = ["All"] + sorted({pretty_category(item["category"]) for item in rows if item["category"]})

    def _theme(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(
            "Dark.Treeview",
            background=PANEL,
            fieldbackground=PANEL,
            foreground=TEXT,
            rowheight=68,
            borderwidth=0,
            font=("Segoe UI", 11),
        )
        style.configure(
            "Dark.Treeview.Heading",
            background=PANEL2,
            foreground=MUTED,
            relief="flat",
            font=("Segoe UI", 9),
        )
        style.map(
            "Dark.Treeview",
            background=[("selected", SELECT)],
            foreground=[("selected", TEXT)],
        )
        style.configure(
            "Dark.Vertical.TScrollbar",
            background=PANEL2,
            troughcolor=BG,
            arrowcolor=MUTED,
            borderwidth=0,
        )
        style.configure(
            "Gold.Horizontal.TProgressbar",
            troughcolor="#3a3126",
            background=GOLD,
            bordercolor="#3a3126",
            lightcolor=GOLD,
            darkcolor=GOLD,
        )
        style.configure(
            "Dark.TCombobox",
            fieldbackground=PANEL2,
            background=PANEL2,
            foreground=TEXT,
            arrowcolor=GOLD,
            borderwidth=0,
            relief="flat",
        )

    def _build(self):
        header = tk.Frame(self, bg=BG)
        header.pack(fill="x", padx=18, pady=(16, 0))
        tk.Label(header, text="ENSHROUDED", bg=BG, fg=GOLD, font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tk.Label(header, text="Backpack", bg=BG, fg=TEXT, font=("Georgia", 26)).pack(anchor="w")
        tk.Label(
            header,
            text="New stacks go into empty slots only. Nothing already in the bag is removed or replaced.",
            bg=BG,
            fg=MUTED,
            font=("Segoe UI", 10),
        ).pack(anchor="w", pady=(2, 10))
        tk.Frame(self, bg=GOLD, height=2).pack(fill="x", padx=18)

        path_row = tk.Frame(self, bg=BG)
        path_row.pack(fill="x", padx=18, pady=12)
        tk.Label(path_row, text="Character", bg=BG, fg=MUTED, font=("Segoe UI", 10)).pack(side="left")
        entry = tk.Entry(
            path_row,
            textvariable=self.character,
            bg=PANEL2,
            fg=TEXT,
            insertbackground=TEXT,
            relief="flat",
            font=("Segoe UI", 10),
        )
        entry.pack(side="left", fill="x", expand=True, padx=8, ipady=5)
        self._button(path_row, "Browse", self.browse).pack(side="left")
        self._button(path_row, "Refresh bag", self.refresh_bag).pack(side="left", padx=(8, 0))
        self._button(path_row, "Restore backup", self.restore_backup).pack(side="left", padx=(8, 0))

        action = tk.Frame(self, bg=BG)
        action.pack(fill="x", padx=18, pady=(0, 10))
        self.apply_button = self._button(action, "Add into empty slots", self.apply_adds, gold=True)
        self.apply_button.pack(fill="x", ipady=6)

        body = tk.Frame(self, bg=BG)
        body.grid_columnconfigure(0, weight=5)
        body.grid_columnconfigure(1, weight=3)
        body.grid_columnconfigure(2, weight=3)
        body.grid_rowconfigure(0, weight=1)

        catalog_outer, catalog = self._card(body)
        catalog_outer.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        self._section(catalog, "Catalog")
        filters = tk.Frame(catalog, bg=PANEL)
        filters.pack(fill="x", padx=10, pady=(0, 8))
        search = tk.Entry(
            filters,
            textvariable=self.search,
            bg=PANEL2,
            fg=TEXT,
            insertbackground=TEXT,
            relief="flat",
            font=("Segoe UI", 11),
        )
        search.pack(side="left", fill="x", expand=True, ipady=6)
        self.category_box = ttk.Combobox(
            filters,
            textvariable=self.category,
            values=self.categories,
            state="readonly",
            width=16,
            style="Dark.TCombobox",
        )
        self.category_box.pack(side="left", padx=(8, 0), ipady=4)

        tree_wrap = tk.Frame(catalog, bg=PANEL)
        tree_wrap.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        self.catalog_tree = ttk.Treeview(
            tree_wrap,
            columns=("max", "category"),
            show="tree headings",
            selectmode="browse",
            style="Dark.Treeview",
            height=8,
        )
        self.catalog_tree.heading("#0", text="Item")
        self.catalog_tree.heading("max", text="Max")
        self.catalog_tree.heading("category", text="Category")
        self.catalog_tree.column("#0", width=280, stretch=True)
        self.catalog_tree.column("max", width=64, anchor="e", stretch=False)
        self.catalog_tree.column("category", width=120, stretch=False)
        scroll = ttk.Scrollbar(tree_wrap, orient="vertical", command=self.catalog_tree.yview, style="Dark.Vertical.TScrollbar")
        self.catalog_tree.configure(yscrollcommand=scroll.set)
        self.catalog_tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self.catalog_tree.bind("<<TreeviewSelect>>", lambda _e: self._on_catalog_select())
        self.catalog_tree.bind("<Double-1>", lambda _e: self.add_pending())

        detail_outer, detail = self._card(body)
        detail_outer.grid(row=0, column=1, sticky="nsew", padx=8)
        self._section(detail, "Item")
        self.preview = tk.Label(detail, bg=PANEL, image=self._blank(168), width=168, height=168)
        self.preview.pack(pady=(4, 8))
        self.preview_name = tk.Label(detail, text="Select an item", bg=PANEL, fg=TEXT, font=("Georgia", 18), wraplength=300, justify="center")
        self.preview_name.pack(padx=16)
        self.preview_meta = tk.Label(detail, text="", bg=PANEL, fg=MUTED, font=("Segoe UI", 10), wraplength=300, justify="center")
        self.preview_meta.pack(padx=16, pady=(4, 10))
        self.desc = tk.Text(
            detail,
            height=8,
            wrap="word",
            bg=PANEL2,
            fg=TEXT,
            relief="flat",
            font=("Segoe UI", 11),
            padx=12,
            pady=10,
            highlightthickness=0,
            cursor="arrow",
        )
        self.desc.pack(fill="both", expand=True, padx=16, pady=(0, 12))
        self.desc.insert("1.0", "Pick an item to see its picture and description. Quantity cannot pass the stack size.")
        self.desc.configure(state="disabled")

        qty = tk.Frame(detail, bg=PANEL)
        qty.pack(fill="x", padx=16, pady=(0, 16))
        tk.Label(qty, text="Quantity", bg=PANEL, fg=MUTED, font=("Segoe UI", 10)).pack(side="left")
        self.qty_box = tk.Spinbox(
            qty,
            from_=1,
            to=1,
            textvariable=self.quantity,
            width=7,
            bg=PANEL2,
            fg=TEXT,
            buttonbackground=PANEL2,
            relief="flat",
            font=("Segoe UI", 11),
            insertbackground=TEXT,
            justify="center",
        )
        self.qty_box.pack(side="left", padx=8, ipady=3)
        self._button(qty, "Max", self.set_max).pack(side="left")
        self._button(qty, "Add to list", self.add_pending, gold=True).pack(side="right")

        side = tk.Frame(body, bg=BG)
        side.grid(row=0, column=2, sticky="nsew", padx=(8, 0))
        side.grid_rowconfigure(0, weight=1)
        side.grid_rowconfigure(1, weight=1)
        side.grid_columnconfigure(0, weight=1)

        pending_outer, pending = self._card(side)
        pending_outer.grid(row=0, column=0, sticky="nsew", pady=(0, 8))
        self._section(pending, "Items to add")
        pending_wrap = tk.Frame(pending, bg=PANEL)
        pending_wrap.pack(fill="both", expand=True, padx=8)
        self.pending_tree = ttk.Treeview(
            pending_wrap,
            columns=("qty",),
            show="tree headings",
            selectmode="browse",
            style="Dark.Treeview",
            height=5,
        )
        self.pending_tree.heading("#0", text="Item")
        self.pending_tree.heading("qty", text="Quantity")
        self.pending_tree.column("#0", width=180, stretch=True)
        self.pending_tree.column("qty", width=80, anchor="e", stretch=False)
        self.pending_tree.pack(fill="both", expand=True)
        pending_buttons = tk.Frame(pending, bg=PANEL)
        pending_buttons.pack(fill="x", padx=10, pady=8)
        self._button(pending_buttons, "Remove from list", self.remove_pending).pack(side="left")
        self._button(pending_buttons, "Clear list", self.clear_pending).pack(side="left", padx=6)
        self.pending_note = tk.Label(pending, text="The list is not in the game yet. Click Add into empty slots above.", bg=PANEL, fg=MUTED, font=("Segoe UI", 9), wraplength=320, justify="left")
        self.pending_note.pack(anchor="w", padx=12, pady=(0, 12))

        bag_outer, bag = self._card(side)
        bag_outer.grid(row=1, column=0, sticky="nsew")
        self._section(bag, "Current backpack")
        bag_wrap = tk.Frame(bag, bg=PANEL)
        bag_wrap.pack(fill="both", expand=True, padx=8, pady=(0, 4))
        self.bag_tree = ttk.Treeview(
            bag_wrap,
            columns=("count",),
            show="tree headings",
            selectmode="browse",
            style="Dark.Treeview",
            height=6,
        )
        self.bag_tree.heading("#0", text="Slot")
        self.bag_tree.heading("count", text="Quantity")
        self.bag_tree.column("#0", width=200, stretch=True)
        self.bag_tree.column("count", width=80, anchor="e", stretch=False)
        bag_scroll = ttk.Scrollbar(bag_wrap, orient="vertical", command=self.bag_tree.yview, style="Dark.Vertical.TScrollbar")
        self.bag_tree.configure(yscrollcommand=bag_scroll.set)
        self.bag_tree.pack(side="left", fill="both", expand=True)
        bag_scroll.pack(side="right", fill="y")
        self.bag_tree.bind("<<TreeviewSelect>>", lambda _e: self._on_bag_select())
        tk.Label(bag, text="Read only. Nothing here is removed or replaced.", bg=PANEL, fg=MUTED, font=("Segoe UI", 9)).pack(anchor="w", padx=12, pady=(0, 10))

        status = tk.Frame(self, bg=PANEL2)
        self.progress = ttk.Progressbar(status, mode="indeterminate", style="Gold.Horizontal.TProgressbar")
        self.status_label = tk.Label(status, textvariable=self.status, bg=PANEL2, fg=MUTED, font=("Segoe UI", 10), anchor="w")
        self.status_label.pack(fill="x", padx=18, pady=8)
        status.pack(side="bottom", fill="x")
        body.pack(fill="both", expand=True, padx=18, pady=(0, 8))
        self._fill_catalog()

    def _card(self, parent):
        outer = tk.Frame(parent, bg=LINE)
        inner = tk.Frame(outer, bg=PANEL)
        inner.pack(fill="both", expand=True, padx=1, pady=1)
        return outer, inner

    def _section(self, parent, title):
        tk.Label(parent, text=title.upper(), bg=PANEL, fg=GOLD, font=("Segoe UI", 9, "bold")).pack(anchor="w", padx=12, pady=(10, 6))

    def _button(self, parent, text, command, gold=False):
        bg = GOLD if gold else "#3a3126"
        fg = INK if gold else TEXT
        return tk.Button(
            parent,
            text=text,
            command=command,
            bg=bg,
            fg=fg,
            activebackground=GOLD,
            activeforeground=INK,
            relief="flat",
            padx=12,
            pady=6,
            cursor="hand2",
            font=("Segoe UI", 10, "bold" if gold else "normal"),
        )

    def _blank(self, size):
        if size in self.blanks:
            return self.blanks[size]
        img = tk.PhotoImage(width=size, height=size)
        img.put(PANEL2, to=(0, 0, size, size))
        img.put(GOLD, to=(0, 0, size, 2))
        img.put(GOLD, to=(0, size - 2, size, size))
        img.put(GOLD, to=(0, 0, 2, size))
        img.put(GOLD, to=(size - 2, 0, size, size))
        self.blanks[size] = img
        return img

    def _photo(self, item_id, size):
        cache = self.photos["list" if size == LIST_ICON else "detail"]
        cached = cache.get(item_id)
        if cached is not None:
            return cached
        path = os.path.join(ICON_DIR, item_id + ".png")
        if not os.path.isfile(path):
            img = self._blank(size)
        else:
            img = tk.PhotoImage(file=path)
            factor = max(1, int(round(img.width() / size)))
            if factor > 1:
                img = img.subsample(factor, factor)
        cache[item_id] = img
        return img

    def _schedule_filter(self, *_args):
        if self._filter_job:
            self.after_cancel(self._filter_job)
        self._filter_job = self.after(160, self._fill_catalog)

    def _fill_catalog(self):
        self._filter_job = None
        query = self.search.get().strip().lower()
        category = self.category.get()
        previous = self.catalog_tree.selection()
        previous_id = previous[0] if previous else None
        rows = []
        for item in self.catalog:
            if category != "All" and pretty_category(item["category"]) != category:
                continue
            if query and query not in item["name"].lower() and query not in item["id"] and query not in item["desc"].lower():
                continue
            rows.append(item)
            if len(rows) == 300:
                break
        self.catalog_tree.delete(*self.catalog_tree.get_children())
        for item in rows:
            self.catalog_tree.insert(
                "",
                "end",
                iid=item["id"],
                text="  " + item["name"],
                image=self._photo(item["id"], LIST_ICON),
                values=(item["max"], pretty_category(item["category"])),
            )
        if previous_id and self.catalog_tree.exists(previous_id):
            self.catalog_tree.selection_set(previous_id)
            self.catalog_tree.see(previous_id)
        if len(rows) >= 300:
            self.status.set("Showing the first 300 matches. Keep typing to narrow the list.")

    def _set_description(self, text):
        self.desc.configure(state="normal")
        self.desc.delete("1.0", "end")
        self.desc.insert("1.0", text)
        self.desc.configure(state="disabled")

    def _show_item(self, item):
        if not item:
            return
        self.shown = item
        color = RARITY_COLORS[item["rarity_index"]] if 0 <= item["rarity_index"] < len(RARITY_COLORS) else TEXT
        self.preview.configure(image=self._photo(item["id"], 168))
        self.preview_name.configure(text=item["name"], fg=color)
        bits = [bit for bit in (item["rarity"], pretty_category(item["category"]), "stack " + str(item["max"])) if bit]
        self.preview_meta.configure(text="  ·  ".join(bits))
        self._set_description(item["desc"] or "No description is stored for this item.")
        self.qty_box.configure(to=item["max"])
        try:
            current = int(self.quantity.get())
        except (tk.TclError, ValueError):
            current = 1
        if current > item["max"]:
            self.quantity.set(item["max"])
        if current < 1:
            self.quantity.set(1)

    def _on_catalog_select(self):
        item = self.selected_item()
        if item:
            self._show_item(item)

    def _on_bag_select(self):
        selected = self.bag_tree.selection()
        if not selected:
            return
        item = self.bag_lookup.get(selected[0])
        if item:
            self._show_item(item)

    def selected_item(self):
        selected = self.catalog_tree.selection()
        if not selected:
            return None
        return self.by_id.get(selected[0])

    def set_max(self):
        item = self.shown or self.selected_item()
        if item:
            self.quantity.set(item["max"])

    def add_pending(self):
        item = self.selected_item() or self.shown
        if not item:
            self.status.set("Select an item from the catalog first.")
            return
        try:
            count = int(self.quantity.get())
        except (tk.TclError, ValueError):
            self.status.set("Quantity has to be a whole number.")
            return
        if count < 1 or count > item["max"]:
            self.status.set(item["name"] + " accepts a quantity from 1 to " + str(item["max"]) + ".")
            return
        self.pending.append({"id": item["id"], "name": item["name"], "count": count, "max": item["max"]})
        self._fill_pending()

    def _fill_pending(self):
        self.pending_tree.delete(*self.pending_tree.get_children())
        for index, item in enumerate(self.pending):
            self.pending_tree.insert(
                "",
                "end",
                iid="pend-" + str(index),
                text="  " + item["name"],
                image=self._photo(item["id"], LIST_ICON),
                values=(item["count"],),
            )
        need = len(self.pending)
        free = len(self.free_slots)
        self.pending_note.configure(
            text=str(need) + " empty slot" + ("" if need == 1 else "s") + " needed. "
            + str(free) + " empty slot" + ("" if free == 1 else "s") + " in the backpack."
        )

    def remove_pending(self):
        selected = self.pending_tree.selection()
        if not selected:
            return
        index = int(selected[0].split("-", 1)[1])
        del self.pending[index]
        self._fill_pending()

    def clear_pending(self):
        self.pending.clear()
        self._fill_pending()

    def browse(self):
        path = filedialog.askopenfilename(
            title="Choose character0.ksd",
            filetypes=[("Enshrouded character", "*.ksd"), ("All files", "*.*")],
            initialdir=os.path.dirname(self.character.get() or DEFAULT_CHARACTER),
        )
        if path:
            self.character.set(path)
            self.refresh_bag()

    def _busy(self, message, work, done):
        if self._working:
            return
        self._working = True
        self.status.set(message)
        self.progress.pack(fill="x", padx=18, pady=(8, 0), before=self.status_label)
        self.progress.start(12)
        self.apply_button.configure(state="disabled")
        self.configure(cursor="watch")
        holder = {"ready": False, "data": None}

        def target():
            try:
                holder["data"] = work()
            except Exception as exc:
                holder["data"] = {"ok": False, "error": str(exc)}
            holder["ready"] = True

        def poll():
            if not holder["ready"]:
                self.after(50, poll)
                return
            self.progress.stop()
            self.progress.pack_forget()
            self.apply_button.configure(state="normal")
            self.configure(cursor="")
            self._working = False
            done(holder["data"] or {"ok": False, "error": "The save tool did not answer."})

        threading.Thread(target=target, daemon=True).start()
        self.after(50, poll)

    def _show_bag(self, data):
        self.bag_tree.delete(*self.bag_tree.get_children())
        self.bag_lookup = {}
        if not data.get("ok"):
            self.free_slots = []
            self.status.set(data.get("error") or "Could not read the backpack.")
            self._fill_pending()
            return
        self.free_slots = data.get("free") or []
        for raw in data.get("items") or []:
            known = self.by_id.get(raw["id"])
            item = known or {
                "id": raw["id"],
                "name": raw["name"],
                "category": "",
                "rarity": "",
                "rarity_index": 0,
                "max": raw["count"],
                "desc": "",
            }
            iid = "slot-" + str(raw["slot"])
            self.bag_lookup[iid] = item
            self.bag_tree.insert(
                "",
                "end",
                iid=iid,
                text="  " + str(raw["slot"]) + "   " + item["name"],
                image=self._photo(item["id"], LIST_ICON),
                values=(raw["count"],),
            )
        self.status.set("Level " + str(data.get("level")) + ". " + str(len(self.free_slots)) + " empty backpack slots. Revision " + str(data.get("revision")) + ".")
        self._fill_pending()

    def refresh_bag(self):
        path = self.character.get().strip()
        self._busy("Reading the backpack...", lambda: run_node(NODE_BAG, [path]), self._show_bag)

    def apply_adds(self):
        if not self.pending:
            self.status.set("Add at least one item to the list first.")
            return
        if len(self.pending) > len(self.free_slots):
            self.status.set("Not enough empty slots. Remove some lines from the list, or clear a slot in the game first.")
            return
        if not messagebox.askyesno(
            "Add items",
            "Add " + str(len(self.pending)) + " stack" + ("" if len(self.pending) == 1 else "s") + " into empty backpack slots?\n\nA backup of the character is saved first. Existing items stay where they are.",
        ):
            return
        path = self.character.get().strip()
        request = os.path.join(HOME, "backups", "pending-add.json")
        os.makedirs(os.path.dirname(request), exist_ok=True)
        payload = [{"id": item["id"], "count": item["count"]} for item in self.pending]
        with open(request, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)

        def work():
            added = run_node(NODE_ADD, [path, request])
            bag = run_node(NODE_BAG, [path])
            return {"added": added, "bag": bag}

        def done(result):
            added = result.get("added") or result
            self._show_bag(result.get("bag") or {"ok": False, "error": "Could not read the backpack."})
            if not added.get("ok"):
                messagebox.showerror("Nothing was changed", added.get("error") or "The add was refused.")
                if added.get("error"):
                    self.status.set(added.get("error"))
                return
            placed = added.get("placed") or []
            self.pending.clear()
            self._fill_pending()
            lines = "\n".join("Slot " + str(item["slot"]) + ": " + item["name"] + " x" + str(item["count"]) for item in placed)
            messagebox.showinfo("Added", lines or "Added.")
            self.status.set("Added " + str(len(placed)) + " stack" + ("" if len(placed) == 1 else "s") + ". A backup was saved first. Use Restore backup to put the character back.")

        self._busy("Saving a backup, then adding into empty slots...", work, done)

    def restore_backup(self):
        path = self.character.get().strip()
        if not path:
            self.status.set("Choose a character file first.")
            return
        if not messagebox.askyesno(
            "Restore backup",
            "Put this character back to the copy saved just before the last edit?\n\nThe current file is copied first.",
        ):
            return
        path = self.character.get().strip()

        def work():
            restored = run_node(NODE_RESTORE, [path])
            bag = run_node(NODE_BAG, [path])
            return {"restored": restored, "bag": bag}

        def done(result):
            restored = result.get("restored") or result
            if not restored.get("ok"):
                messagebox.showerror("Nothing was changed", restored.get("error") or "No backup could be restored.")
                self.status.set(restored.get("error") or "Nothing was changed.")
                return
            self.pending.clear()
            self._show_bag(result.get("bag") or {"ok": False, "error": "Could not read the backpack."})
            if restored.get("already"):
                self.status.set("The backpack already matches the last backup.")
                return
            messagebox.showinfo("Restored", "The character is back to the backup saved before the last edit.")
            self.status.set("Restored the backup. The edited character was copied into backups first.")

        self._busy("Restoring the character from the last backup...", work, done)


def main():
    try:
        app = App()
        app.mainloop()
    except Exception as exc:
        log = os.path.join(HOME, "error.log")
        with open(log, "w", encoding="utf-8") as handle:
            handle.write(str(exc))
        raise


if __name__ == "__main__":
    main()
