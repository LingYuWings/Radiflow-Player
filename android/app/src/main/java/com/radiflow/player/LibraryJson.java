package com.radiflow.player;

import org.json.JSONException;
import org.json.JSONObject;

/** JSONObject whose put() does not throw checked exceptions (keys are always valid here). */
final class LibraryJson extends JSONObject {
    @Override
    public LibraryJson put(String name, Object value) {
        try {
            super.put(name, value);
        } catch (JSONException error) {
            throw new IllegalArgumentException(error);
        }
        return this;
    }

    @Override
    public LibraryJson put(String name, int value) {
        return put(name, (Object) value);
    }

    @Override
    public LibraryJson put(String name, long value) {
        return put(name, (Object) value);
    }

    @Override
    public LibraryJson put(String name, double value) {
        return put(name, (Object) value);
    }

    @Override
    public LibraryJson put(String name, boolean value) {
        return put(name, (Object) value);
    }
}
