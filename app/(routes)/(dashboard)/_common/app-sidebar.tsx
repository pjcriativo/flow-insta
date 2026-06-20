"use client"
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { Calendar, CreditCard, Lightbulb, Plus, PlusCircleIcon, Settings, Shield, Home, BarChart3, ClipboardCheck, Scissors, Bot, MessageSquare } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import Logo from '@/components/logo';
import { Button } from '@/components/ui/button';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { getChannelIcon, getChannelUrl } from '@/constants/channels';
import { ChannelType } from '@/types/channel.type';
import { PlusSignIcon } from '@hugeicons/core-free-icons';
import { useAuthUser } from '@/components/auth-provider';
import { useActiveOrg } from '@/components/active-org-provider';
import { OrgSwitcher } from './org-switcher';
import ChannelAvatar from '@/components/channel-avatar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import CreatePostDialog from '@/components/schedule/create-post-dialog';

const mainNav = [
  { name: "Início", href: "/home", icon: Home },
  { name: "Agenda", href: "/schedule", icon: Calendar },
  { name: "Atomizar", href: "/atomizar", icon: Scissors },
  { name: "Caixa de entrada", href: "/inbox", icon: MessageSquare },
  { name: "Automação", href: "/automacao", icon: Bot },
  { name: "Aprovações", href: "/aprovacoes", icon: ClipboardCheck },
  { name: "Análises", href: "/analytics", icon: BarChart3 },
  { name: "Ideias", href: "/ideas", icon: Lightbulb },
  { name: "Cobrança", href: "/billing", icon: CreditCard },
  { name: "Configurações", href: "/settings", icon: Settings },
];

const AppSidebar = () => {
  const pathname = usePathname();
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"
  const { user, signOut } = useAuthUser()
  const { activeOrgId, isPlatformAdmin } = useActiveOrg()
  const router = useRouter()
  const [isCreatePostOpen, setIsCreatePostOpen] = useState<boolean>(false)

  const handleSignOut = async () => {
    await signOut()
    router.push("/sign-in")
    router.refresh()
  }

   const connectMutation = useMutation({
    mutationFn: async (channelTypeId: string) => {
      const res = await fetch("/api/channel/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelTypeId,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to connect channel")
      }
      return data
    },
    onSuccess: ({url}) => {
      window.location.href = url
    },
    onError: () => {
      toast.error("Failed to connect channel")
    }
  })

  const {data:channelsData, isPending} = useQuery({
    queryKey: ["channels", activeOrgId],
    queryFn: async () => {
      const res = await fetch("/api/channel");
      const data = await res.json();
      return data
    }
  })
  
  const channels = (channelsData?.channels || []) as ChannelType[]
  const unconnectedChannels = channels.filter((channel: ChannelType) => !channel.connected);
  const connectedChannels = channels.filter((channel: ChannelType) => channel.connected);

  const connectedCount = channelsData?.connectedCount || 0;
  const totalChannels = channelsData?.totalChannels || 0;
  const limitedChannels = unconnectedChannels.slice(0, 4);


  const handleConnect = (channelTypeId: string) => {
    if(connectMutation.isPending) return;
    connectMutation.mutate(channelTypeId);
  }
 

  return (
    <>
    <Sidebar collapsible="icon">
      <SidebarHeader className={cn("p-4", isCollapsed && "p-2")}>
        <div className='flex items-center justify-between'>
           <Logo hideName={isCollapsed} />
           <SidebarTrigger className="hidden md:flex -mx-8 mb-0" />
        </div>
        <div className="mt-3">
          <OrgSwitcher collapsed={isCollapsed} />
        </div>
        <Button className='mt-4 w-full'
         size={isCollapsed ? "icon": "lg"}
         onClick={() => setIsCreatePostOpen(true)}
        >
            <Plus className="size-4" />
           {!isCollapsed && <span>Nova publicação</span>}
        </Button>
      </SidebarHeader>
      <SidebarContent className={cn(!isCollapsed && "px-2")}>
        <SidebarGroup>
            <SidebarGroupContent>
                <SidebarMenu>
                    {mainNav.map((item) => (
                        <SidebarMenuItem key={item.name}>
                            <SidebarMenuButton asChild
                            isActive={pathname === item.href}
                    tooltip={item.name}
                            >
                                <Link href={item.href}>
                                    <item.icon className="size-4" />
                                    <span className='text-sm'>{item.name}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    ))}
                    {isPlatformAdmin && (
                        <SidebarMenuItem>
                            <SidebarMenuButton asChild
                                isActive={pathname.startsWith("/admin")}
                                tooltip="Admin"
                            >
                                <Link href="/admin">
                                    <Shield className="size-4" />
                                    <span className='text-sm'>Admin</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    )}
                </SidebarMenu>
            </SidebarGroupContent>
        </SidebarGroup>

        {/* {connected channels} */}
         {connectedChannels.length > 0 && (
         <SidebarGroup className={cn(isCollapsed && "px-1")}>
          <SidebarGroupLabel className='text-sm'>Canais</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
               {isPending ? (
                <div className='flex flex-col gap-2'>
                  <Skeleton className='h-8 w-full bg-secondary' />
                  <Skeleton className='h-8 w-full bg-secondary' />
                  <Skeleton className='h-8 w-full bg-secondary' />
                  <Skeleton className='h-8 w-full bg-secondary' />
                </div>
              ) : (
                connectedChannels?.map((channel: ChannelType) => {
                  const url = getChannelUrl(channel.type)
                  return (
                    <SidebarMenuItem key={channel.id}>
                      <SidebarMenuButton asChild>
                       <a
                         href={`${url}/${channel.handle}`}
                         target="_blank" rel="noreferrer"
                          className="w-full! relative block items-center gap-2"
                       >
                           <ChannelAvatar
                            size="sm"
                           className="w-full flex items-center gap-2"
                            type={channel.type}
                            color={channel.color}
                            profileImage={channel.profile_image}
                            name={!isCollapsed ? (channel.handle || channel.name) : ""}
                           />
                       </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })
              )}
            </SidebarMenu>
          </SidebarGroupContent>
         </SidebarGroup>
         )}


        {/* {unconnected channels} */}
         <SidebarGroup className={cn(isCollapsed && "px-1")}>
          <SidebarGroupLabel className='text-sm'>Conectar canais</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isPending ? (
                <div className='flex flex-col gap-2'>
                  <Skeleton className='h-8 w-full bg-secondary' />
                  <Skeleton className='h-8 w-full bg-secondary' />
                  <Skeleton className='h-8 w-full bg-secondary' />
                  <Skeleton className='h-8 w-full bg-secondary' />
                </div>
              ) : (
                <>
                {limitedChannels.map((channel: ChannelType) => {
                  const icon = getChannelIcon(channel.type)
                  return (
                    <SidebarMenuItem key={channel.id}>
                      <SidebarMenuButton asChild
                       tooltip={`Conectar ${channel.name}`}
                      >
                       <button
                        className='w-full flex items-center gap-2'
                        disabled={connectMutation.isPending}
                        onClick={() => handleConnect(channel.id)}
                       >
                          <span>
                             <div className='relative'>
                              {icon ? (
                                <HugeiconsIcon icon={icon} color='currentColor'
                                className=" text-white! size-6! p-1 rounded-sm"
                                  style={{ background: channel.color}}
                                />
                              ) : null}

                              <div className={`absolute -right-1 bottom-0 p-0.5
                                 bg-white dark:bg-background rounded-xs
                                `}>
                                  <HugeiconsIcon icon={PlusSignIcon} className="size-2!" />
                                </div>
                             </div>
                          </span>
                          <span className='truncate'>{channel.name}</span>
                       </button>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Button asChild variant="ghost" className='w-full justify-start mt-1'>
                      <Link href="/settings" className='w-full flex items-center gap-2'>
                      <PlusCircleIcon className='size-4'  />
                      <span className='text-sm'>Mais canais</span>
                      </Link>
                    </Button>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
         </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
         <div className="mb-3 text-xs text-muted-foreground">
          <span>
            {connectedCount}/{totalChannels} canais conectados
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs uppercase">
              {user?.email?.[0] ?? "?"}
            </AvatarFallback>
          </Avatar>
          {!isCollapsed && (
            <>
              <span className="text-sm truncate flex-1">{user?.email}</span>
              <button
                onClick={handleSignOut}
                title="Sair"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="size-4" />
              </button>
            </>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
     <CreatePostDialog
        open={isCreatePostOpen}
        onOpenChange={setIsCreatePostOpen}
      />
    </>
  )
}

export default AppSidebar