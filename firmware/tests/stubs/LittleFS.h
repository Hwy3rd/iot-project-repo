#pragma once
#include "Arduino.h"
#include <map>
#include <memory>
#include <set>
#include <vector>

struct TestFilesystem;
struct TestFile {
  TestFilesystem* fs;
  std::string name;
  bool directory = false;
  size_t position = 0;
  std::vector<std::string> children;
};
class File {
 public:
  File() = default;
  explicit File(std::shared_ptr<TestFile> data) : data(data) {}
  explicit operator bool() const { return !!data; }
  bool isDirectory() const { return data && data->directory; }
  const char* name() const { return data->name.c_str(); }
  void close() {}
  void flush() {}
  File openNextFile();
  size_t print(const char* payload);
  int read();
  size_t readBytes(char* target, size_t count) {
    size_t n = 0;
    for (; n < count; n++) { int c = read(); if (c < 0) break; target[n] = static_cast<char>(c); }
    return n;
  }
 private:
  std::shared_ptr<TestFile> data;
};

// Persisted rows outlive queue objects, allowing reboot and failure injection.
struct TestFilesystem {
  std::map<std::string, std::string> files;
  std::set<std::string> directories;
  bool mountOK = true, formatRequested = false, failWrite = false, failRename = false;
  bool begin(bool format) { formatRequested = format; return mountOK; }
  bool exists(const String& path) const {
    return files.count(path.c_str()) || directories.count(path.c_str());
  }
  bool mkdir(const char* path) { directories.insert(path); return true; }
  bool remove(const String& path) { return files.erase(path.c_str()) != 0; }
  bool rename(const char* source, const String& target) {
    if (failRename || !files.count(source)) return false;
    files[target.c_str()] = files[source]; files.erase(source); return true;
  }
  File open(const String& path, const char* mode = "r") {
    const std::string name = path.c_str();
    const bool directory = directories.count(name) != 0;
    if (!strcmp(mode, "w")) files[name] = "";
    if (!directory && !files.count(name)) return File();
    auto entry = std::make_shared<TestFile>();
    entry->fs = this; entry->name = name; entry->directory = directory;
    if (directory) for (const auto& file : files)
      if (file.first.find(name + "/") == 0) entry->children.push_back(file.first);
    return File(entry);
  }
};
extern TestFilesystem LittleFS;
inline File File::openNextFile() {
  if (!data || data->position >= data->children.size()) return File();
  return data->fs->open(String(data->children[data->position++]));
}
inline size_t File::print(const char* payload) {
  size_t length = data->fs->failWrite ? 1 : strlen(payload);
  data->fs->files[data->name] = std::string(payload, length);
  return length;
}
inline int File::read() {
  const auto& content = data->fs->files[data->name];
  return data->position < content.size() ? static_cast<unsigned char>(content[data->position++]) : -1;
}
