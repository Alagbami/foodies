import { ID } from "react-native-appwrite";
import { appwriteConfig, databases, storage } from "./appwrite";
import dummyData from "./data";

interface Category { name: string; description: string; }
interface Customization { name: string; price: number; type: string; }
interface MenuItem {
  name: string;
  description: string;
  image_url: string;
  price: number;
  rating: number;
  calories: number;
  protein: number;
  category_name: string;
  customizations: string[];
}

const data = dummyData as {
  categories: Category[];
  customizations: Customization[];
  menu: MenuItem[];
};

// Utility: wait “ms” milliseconds
const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

async function clearAll(collectionId: string): Promise<void> {
  console.log(`⏳ Clearing all docs from collection ${collectionId}…`);
  let list;
  try {
    list = await databases.listDocuments(appwriteConfig.databaseId, collectionId);
    console.log(`   → Found ${list.documents.length} docs`);
  } catch (e) {
    console.error(`❌ listDocuments(${collectionId}) failed:`, (e as Error).message);
    return;
  }

  await Promise.all(
    list.documents.map(async doc => {
      try {
        await databases.deleteDocument(
          appwriteConfig.databaseId,
          collectionId,
          doc.$id
        );
        console.log(`   ✓ Deleted doc ${doc.$id}`);
      } catch (e) {
        console.warn(`   ⚠️ Couldn’t delete ${doc.$id}:`, (e as Error).message);
      }
    })
  );
}

async function clearStorage(): Promise<void> {
  console.log(`⏳ Clearing all files from storage bucket ${appwriteConfig.bucketId}…`);
  let list;
  try {
    list = await storage.listFiles(appwriteConfig.bucketId);
    console.log(`   → Found ${list.files.length} files`);
  } catch (e) {
    console.error(`❌ listFiles failed:`, (e as Error).message);
    return;
  }

  await Promise.all(
    list.files.map(async file => {
      try {
        await storage.deleteFile(appwriteConfig.bucketId, file.$id);
        console.log(`   ✓ Deleted file ${file.$id}`);
      } catch (e) {
        console.warn(`   ⚠️ Couldn’t delete file ${file.$id}:`, (e as Error).message);
      }
    })
  );
}

async function uploadImageToStorage(imageUrl: string): Promise<string | null> {
  console.log(`⏳ Uploading image from ${imageUrl}…`);
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const fileObj = {
      name: imageUrl.split("/").pop() || `file-${Date.now()}.jpg`,
      type: blob.type,
      size: blob.size,
      uri: imageUrl,
    };
    const file = await storage.createFile(
      appwriteConfig.bucketId,
      ID.unique(),
      fileObj
    );

    // getFileViewURL returns a URL object — convert it to string
    const viewURL = storage.getFileViewURL(appwriteConfig.bucketId, file.$id);
    const viewURLString = viewURL.toString();

    console.log(`   ✓ Uploaded and got URL ${viewURLString}`);
    return viewURLString;
  } catch (e) {
    console.error(`❌ uploadImage failed for ${imageUrl}:`, (e as Error).message);
    return null;
  }
}


async function seed(): Promise<void> {
  console.log("🚀 Starting seed process…");

  // 1. Clear all collections + storage
  await clearAll(appwriteConfig.categoriesCollectionId);
  await clearAll(appwriteConfig.customizationsCollectionId);
  await clearAll(appwriteConfig.menuCollectionId);
  await clearAll(appwriteConfig.menuCustomizationsCollectionId);
  await clearStorage();

  // 2. Create Categories
  console.log("⏳ Creating categories…");
  const categoryMap: Record<string, string> = {};
  for (const cat of data.categories) {
    try {
      const doc = await databases.createDocument(
        appwriteConfig.databaseId,
        appwriteConfig.categoriesCollectionId,
        ID.unique(),
        { name: cat.name, description: cat.description }
      );
      categoryMap[cat.name] = doc.$id;
      console.log(`   ✓ Category "${cat.name}" → ${doc.$id}`);
    } catch (e) {
      console.error(`❌ Failed to create category ${cat.name}:`, (e as Error).message);
    }
    await wait(300);
  }

  // 3. Create Customizations
  console.log("⏳ Creating customizations…");
  const customizationMap: Record<string, string> = {};
  for (const cus of data.customizations) {
    try {
      const doc = await databases.createDocument(
        appwriteConfig.databaseId,
        appwriteConfig.customizationsCollectionId,
        ID.unique(),
        { name: cus.name, price: cus.price, type: cus.type }
      );
      customizationMap[cus.name] = doc.$id;
      console.log(`   ✓ Customization "${cus.name}" → ${doc.$id}`);
    } catch (e) {
      console.error(`❌ Failed to create customization ${cus.name}:`, (e as Error).message);
    }
    await wait(300);
  }

  // 4. Create Menu Items & link customizations
  console.log("⏳ Creating menu items…");
  for (const item of data.menu) {
    let uploadedUrl: string | null = null;
    try {
      uploadedUrl = await uploadImageToStorage(item.image_url);
    } catch {
      // already logged inside uploadImageToStorage
    }
    if (!uploadedUrl) {
      console.warn(`   ⚠️ Skipping menu item "${item.name}" due to upload failure.`);
      continue;
    }

    let menuDocId: string | null = null;
    try {
      const doc = await databases.createDocument(
        appwriteConfig.databaseId,
        appwriteConfig.menuCollectionId,
        ID.unique(),
        {
          name: item.name,
          description: item.description,
          image_url: uploadedUrl,
          price: item.price,
          rating: item.rating,
          calories: item.calories,
          protein: item.protein,
          categories: categoryMap[item.category_name], // ensure this field name matches your schema
        }
      );
      menuDocId = doc.$id;
      console.log(`   ✓ Menu item "${item.name}" → ${menuDocId}`);
    } catch (e) {
      console.error(`❌ Failed to create menu item ${item.name}:`, (e as Error).message);
      continue;
    }

    // 5. Link customizations
    for (const cusName of item.customizations) {
      await wait(200);
      try {
        await databases.createDocument(
          appwriteConfig.databaseId,
          appwriteConfig.menuCustomizationsCollectionId,
          ID.unique(),
          {
            menu: menuDocId,
            customizations: customizationMap[cusName],
          }
        );
        console.log(`     ✓ Linked "${cusName}" to "${item.name}"`);
      } catch (e) {
        console.warn(
          `     ⚠️ Failed to link customization ${cusName}:`,
          (e as Error).message
        );
      }
    }

    await wait(300);
  }

  console.log("✅ Seeding complete.");
}

export default seed;
