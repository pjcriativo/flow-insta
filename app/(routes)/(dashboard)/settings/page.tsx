"use client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuthUser } from "@/components/auth-provider"
import { Layers, Palette, User } from "lucide-react"
import ChannelsTab from "@/components/settings/channels-tab"
import { useTheme } from "next-themes"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

const SettingsPage = () => {
  const { user, signOut } = useAuthUser()
  const { theme, setTheme } = useTheme()
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut()
    router.push("/sign-in")
    router.refresh()
  }
  return (
    <div className="w-full">
      <div className="max-w-5xl mx-auto w-full h-full">
        <div className="py-4">
          <h1 className="text-xl font-semibold">Settings</h1>
        </div>

        <div>
          <Tabs defaultValue="channels">
            <div className="mb-6 w-full border-b">
              <TabsList variant="line" className="w-fit space-x-4
              group-data-horizontal/tabs:h-12
              ">
                <TabsTrigger value="profile">
                  <User className="size-4" />
                  Profile</TabsTrigger>
                <TabsTrigger value="channels">
                  <Layers className="size-4" />
                  Channels</TabsTrigger>
                <TabsTrigger value="appearance">
                  <Palette className="size-4" />
                  Appearance</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="profile">
              <Card>
                <CardHeader>
                  <CardTitle>
                    Your Profile
                  </CardTitle>
                  <CardDescription>Managr youe account information</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                      <span className="text-xl font-semibold uppercase text-muted-foreground">
                        {user?.email?.[0] ?? <User className="size-8" />}
                      </span>
                    </div>

                    <div>
                      <p className="font-medium">{user?.email || "Sem e-mail"}</p>
                      <p className="text-sm text-muted-foreground">Conta Flow Insta</p>
                    </div>
                  </div>
                  <div className="mt-6">
                    <Button variant="outline" onClick={handleSignOut}>
                      Sair da conta
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="channels">
              <ChannelsTab  />
            </TabsContent>

            <TabsContent value="appearance">
              <Card>
                <CardHeader>
                  <CardTitle>Appearance</CardTitle>
                  <CardDescription>Customize how Flow Insta looks for you</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="theme">Dark mode</Label>
                      <p className="text-sm text-muted-foreground">
                        Toggle between light and dark theme
                      </p>
                    </div>
                    <Switch
                      id="theme"
                      checked={theme === "dark"}
                      onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage