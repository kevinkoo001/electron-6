// Copyright (c) 2016 GitHub, Inc.
// Use of this source code is governed by the MIT license that can be
// found in the LICENSE file.

#include "atom/browser/mac/dict_util.h"

#include "base/json/json_writer.h"
#include "base/strings/sys_string_conversions.h"
#include "base/values.h"

namespace atom {

NSArray* ListValueToNSArray(const base::ListValue& value) {
  std::string json;
  if (!base::JSONWriter::Write(value, &json))
    return nil;
  NSData* jsonData = [NSData dataWithBytes:json.c_str() length:json.length()];
  id obj =
      [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:nil];
  if (![obj isKindOfClass:[NSArray class]])
    return nil;
  return obj;
}

std::unique_ptr<base::ListValue> NSArrayToListValue(NSArray* arr) {
  if (!arr)
    return nullptr;

  auto result = std::make_unique<base::ListValue>();
  for (id value in arr) {
    if ([value isKindOfClass:[NSString class]]) {
      result->AppendString(base::SysNSStringToUTF8(value));
    } else if ([value isKindOfClass:[NSNumber class]]) {
      const char* objc_type = [value objCType];
      if (strcmp(objc_type, @encode(BOOL)) == 0 ||
          strcmp(objc_type, @encode(char)) == 0)
        result->AppendBoolean([value boolValue]);
      else if (strcmp(objc_type, @encode(double)) == 0 ||
               strcmp(objc_type, @encode(float)) == 0)
        result->AppendDouble([value doubleValue]);
      else
        result->AppendInteger([value intValue]);
    } else if ([value isKindOfClass:[NSArray class]]) {
      std::unique_ptr<base::ListValue> sub_arr = NSArrayToListValue(value);
      if (sub_arr)
        result->Append(std::move(sub_arr));
      else
        result->Append(std::make_unique<base::Value>());
    } else if ([value isKindOfClass:[NSDictionary class]]) {
      std::unique_ptr<base::DictionaryValue> sub_dict =
          NSDictionaryToDictionaryValue(value);
      if (sub_dict)
        result->Append(std::move(sub_dict));
      else
        result->Append(std::make_unique<base::Value>());
    } else {
      result->AppendString(base::SysNSStringToUTF8([value description]));
    }
  }

  return result;
}

NSDictionary* DictionaryValueToNSDictionary(
    const base::DictionaryValue& value) {
  std::string json;
  if (!base::JSONWriter::Write(value, &json))
    return nil;
  NSData* jsonData = [NSData dataWithBytes:json.c_str() length:json.length()];
  id obj =
      [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:nil];
  if (![obj isKindOfClass:[NSDictionary class]])
    return nil;
  return obj;
}

std::unique_ptr<base::DictionaryValue> NSDictionaryToDictionaryValue(
    NSDictionary* dict) {
  if (!dict)
    return nullptr;

  auto result = std::make_unique<base::DictionaryValue>();
  for (id key in dict) {
    std::string str_key = base::SysNSStringToUTF8(
        [key isKindOfClass:[NSString class]] ? key : [key description]);

    id value = [dict objectForKey:key];
    if ([value isKindOfClass:[NSString class]]) {
      result->SetKey(str_key, base::Value(base::SysNSStringToUTF8(value)));
    } else if ([value isKindOfClass:[NSNumber class]]) {
      const char* objc_type = [value objCType];
      if (strcmp(objc_type, @encode(BOOL)) == 0 ||
          strcmp(objc_type, @encode(char)) == 0)
        result->SetKey(str_key, base::Value([value boolValue]));
      else if (strcmp(objc_type, @encode(double)) == 0 ||
               strcmp(objc_type, @encode(float)) == 0)
        result->SetKey(str_key, base::Value([value doubleValue]));
      else
        result->SetKey(str_key, base::Value([value intValue]));
    } else if ([value isKindOfClass:[NSArray class]]) {
      std::unique_ptr<base::ListValue> sub_arr = NSArrayToListValue(value);
      if (sub_arr)
        result->SetWithoutPathExpansion(str_key, std::move(sub_arr));
      else
        result->SetWithoutPathExpansion(str_key,
                                        std::make_unique<base::Value>());
    } else if ([value isKindOfClass:[NSDictionary class]]) {
      std::unique_ptr<base::DictionaryValue> sub_dict =
          NSDictionaryToDictionaryValue(value);
      if (sub_dict)
        result->SetWithoutPathExpansion(str_key, std::move(sub_dict));
      else
        result->SetWithoutPathExpansion(str_key,
                                        std::make_unique<base::Value>());
    } else {
      result->SetKey(str_key,
                     base::Value(base::SysNSStringToUTF8([value description])));
    }
  }

  return result;
}

}  // namespace atom
