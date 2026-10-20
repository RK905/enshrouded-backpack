# Enshrouded Backpack

A Windows tool for putting items into an Enshrouded character backpack.

Download **EnshroudedBackpack.exe** from the [releases](https://github.com/RK905/enshrouded-backpack/releases) page and double-click it. It opens the character at the usual Steam path. Use Browse if that character lives somewhere else.

Pick an item from the catalog to see its picture, rarity, and description. Set a quantity up to that item's stack size, and add it to the list. **Add into empty slots** writes those stacks into empty backpack slots.

The tool will not remove an item, and it will not write into a slot that already has something. If the backpack does not have enough empty slots, or Enshrouded is open, it stops and leaves the file as it was. Just before a write, it saves a copy of the character under `backups`, next to the program. **Restore backup** puts the character back to the copy from before the last edit. The edited character is kept in that folder too.

Close Enshrouded before adding. If Steam says the cloud save is out of date, keep the files on this PC.

## Run from source

Install Python and Node.js. From this folder, download the item pictures, then start the window:

```
python engine/fetch_icons.py
python app.py
```

`Start Backpack Tool.bat` does the same start step when Python and Node are already on your PATH.
